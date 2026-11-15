import { signInWithPopup, signOut } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentReference,
} from 'firebase/firestore';
import { OperationType, auth, db, googleProvider, handleFirestoreError } from '../firebase.ts';

export type LicenseType = 'trial_key' | 'permanent';

export interface ActiveLicenseSession {
  username: string;
  docId: string;
  licenseType: LicenseType;
  expiresAtMs: number | null;
  loggedInAtMs: number;
}

export interface ManagedKeyRecord {
  id: string;
  licenseType: LicenseType;
  username: string;
  active: boolean;
  durationHours?: number;
  createdAtMs: number | null;
  activatedAtMs: number | null;
  expiresAtMs: number | null;
}

const SESSION_STORAGE_KEY = 'strenx_firebase_license_session_v1';
const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;
const USERNAME_REGEX = /^[a-zA-Z0-9_.\-@]{2,64}$/;

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function validateUsernameFormat(username: string): string | null {
  const trimmed = username.trim();
  if (!USERNAME_REGEX.test(trimmed)) {
    return 'Username must be 2–64 characters (letters, numbers, _, -, ., @).';
  }
  return null;
}

function toMillis(ts: unknown): number | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toMillis();
  if (
    typeof ts === 'object' &&
    ts !== null &&
    'toMillis' in ts &&
    typeof (ts as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

async function matchesPassword(
  docData: Record<string, unknown>,
  rawPassword: string
): Promise<boolean> {
  if (typeof docData.passwordHash === 'string' && docData.passwordHash.length === 64) {
    const hash = await sha256Hex(rawPassword);
    return docData.passwordHash === hash;
  }
  if (typeof docData.password === 'string') {
    return docData.password === rawPassword;
  }
  return false;
}

async function findKeyDocument(
  collectionName: LicenseType,
  username: string
): Promise<{ ref: DocumentReference; data: Record<string, unknown>; docId: string } | null> {
  // 1. Direct Document ID lookup (docId === username)
  const directRef = doc(db, collectionName, username);
  try {
    const directSnap = await getDocFromServer(directRef);
    if (directSnap.exists()) {
      return {
        ref: directRef,
        data: directSnap.data() as Record<string, unknown>,
        docId: directSnap.id,
      };
    }
  } catch (err) {
    // If offline or permission error on direct get, rethrow via handler unless fallback query works
    if (err instanceof Error && err.message.includes('the client is offline')) {
      throw new Error('Unable to reach Firebase Firestore. Check your internet connection.');
    }
  }

  // 2. Fallback query by `username` field (for auto-ID documents created in Firebase Console)
  try {
    const q = query(collection(db, collectionName), where('username', '==', username), limit(1));
    const qSnap = await getDocsFromServer(q);
    if (!qSnap.empty) {
      const matched = qSnap.docs[0];
      return {
        ref: matched.ref,
        data: matched.data() as Record<string, unknown>,
        docId: matched.id,
      };
    }
  } catch {
    // List queries may be restricted by rules if only docId lookup is allowed
  }

  return null;
}

export async function loginWithFirebaseCollections(
  rawUsername: string,
  rawPassword: string
): Promise<ActiveLicenseSession> {
  const username = rawUsername.trim();
  const formatErr = validateUsernameFormat(username);
  if (formatErr) {
    throw new Error(formatErr);
  }
  if (!rawPassword) {
    throw new Error('Password is required.');
  }

  // 1. Check `permanent` collection
  const permMatch = await findKeyDocument('permanent', username);
  if (permMatch) {
    const { data, docId } = permMatch;
    if (data.active === false) {
      throw new Error('This permanent account has been disabled.');
    }
    const ok = await matchesPassword(data, rawPassword);
    if (!ok) {
      throw new Error('Invalid username or password.');
    }

    const session: ActiveLicenseSession = {
      username,
      docId,
      licenseType: 'permanent',
      expiresAtMs: null,
      loggedInAtMs: Date.now(),
    };
    saveLocalSession(session);
    return session;
  }

  // 2. Check `trial_key` collection (24-hour validity only)
  const trialMatch = await findKeyDocument('trial_key', username);
  if (trialMatch) {
    const { ref, data, docId } = trialMatch;
    if (data.active === false) {
      throw new Error('This 24-hour trial key has been disabled.');
    }
    const ok = await matchesPassword(data, rawPassword);
    if (!ok) {
      throw new Error('Invalid username or password.');
    }

    const explicitExpiresMs = toMillis(data.expiresAt);
    let expiresAtMs: number;

    if (explicitExpiresMs !== null) {
      expiresAtMs = explicitExpiresMs;
    } else {
      let activatedMs = toMillis(data.activatedAt);
      if (activatedMs === null) {
        try {
          await updateDoc(ref, { activatedAt: serverTimestamp() });
          const refreshed = await getDocFromServer(ref);
          activatedMs = toMillis(refreshed.data()?.activatedAt) ?? Date.now();
        } catch {
          activatedMs = toMillis(data.createdAt) ?? Date.now();
        }
      }
      expiresAtMs = activatedMs + TRIAL_DURATION_MS;
    }

    if (Date.now() >= expiresAtMs) {
      throw new Error('This 24-hour trial key has expired.');
    }

    const session: ActiveLicenseSession = {
      username,
      docId,
      licenseType: 'trial_key',
      expiresAtMs,
      loggedInAtMs: Date.now(),
    };
    saveLocalSession(session);
    return session;
  }

  throw new Error('Invalid username or password.');
}

export async function verifySessionWithServer(
  session: ActiveLicenseSession
): Promise<{ valid: boolean; reason?: string; updatedSession?: ActiveLicenseSession }> {
  if (session.licenseType === 'trial_key' && session.expiresAtMs && Date.now() >= session.expiresAtMs) {
    return { valid: false, reason: 'Your 24-hour trial key has expired.' };
  }

  const docKey = session.docId || session.username;
  const ref = doc(db, session.licenseType, docKey);

  try {
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) {
      return { valid: false, reason: 'Account no longer exists in Firebase.' };
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.active === false) {
      return { valid: false, reason: 'Account has been disabled by the administrator.' };
    }

    if (session.licenseType === 'trial_key') {
      const explicitExpires = toMillis(data.expiresAt);
      const activatedMs = toMillis(data.activatedAt) ?? toMillis(data.createdAt);
      const expiresAtMs = explicitExpires ?? (activatedMs !== null ? activatedMs + TRIAL_DURATION_MS : session.expiresAtMs);

      if (expiresAtMs !== null) {
        if (Date.now() >= expiresAtMs) {
          return { valid: false, reason: 'Your 24-hour trial key has expired.' };
        }
        return {
          valid: true,
          updatedSession: { ...session, expiresAtMs },
        };
      }
    }

    return { valid: true };
  } catch {
    if (session.licenseType === 'trial_key' && session.expiresAtMs && Date.now() >= session.expiresAtMs) {
      return { valid: false, reason: 'Your 24-hour trial key has expired.' };
    }
    return { valid: true };
  }
}

export function loadLocalSession(): ActiveLicenseSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveLicenseSession;
    if (!parsed.username || !parsed.licenseType) return null;
    if (parsed.licenseType === 'trial_key' && parsed.expiresAtMs && Date.now() >= parsed.expiresAtMs) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalSession(session: ActiveLicenseSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearLocalSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function signInAdminWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutAdmin(): Promise<void> {
  await signOut(auth);
}

export async function listAllLicenseKeys(): Promise<ManagedKeyRecord[]> {
  const results: ManagedKeyRecord[] = [];

  try {
    const permSnap = await getDocs(collection(db, 'permanent'));
    permSnap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      results.push({
        id: docSnap.id,
        licenseType: 'permanent',
        username: String(d.username || docSnap.id),
        active: d.active !== false,
        createdAtMs: toMillis(d.createdAt),
        activatedAtMs: null,
        expiresAtMs: null,
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'permanent');
  }

  try {
    const trialSnap = await getDocs(collection(db, 'trial_key'));
    trialSnap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      const explicitExpires = toMillis(d.expiresAt);
      const activatedAtMs = toMillis(d.activatedAt);
      const expiresAtMs = explicitExpires ?? (activatedAtMs ? activatedAtMs + TRIAL_DURATION_MS : null);
      results.push({
        id: docSnap.id,
        licenseType: 'trial_key',
        username: String(d.username || docSnap.id),
        active: d.active !== false,
        durationHours: typeof d.durationHours === 'number' ? d.durationHours : 24,
        createdAtMs: toMillis(d.createdAt),
        activatedAtMs,
        expiresAtMs,
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'trial_key');
  }

  return results.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
}

export async function createLicenseKey(params: {
  licenseType: LicenseType;
  username: string;
  password: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Admin sign-in is required.');
  }

  const username = params.username.trim();
  const formatErr = validateUsernameFormat(username);
  if (formatErr) throw new Error(formatErr);

  if (params.password.length < 4 || params.password.length > 128) {
    throw new Error('Password must be 4–128 characters long.');
  }

  const passwordHash = await sha256Hex(params.password);
  const path = `${params.licenseType}/${username}`;

  try {
    if (params.licenseType === 'trial_key') {
      await setDoc(doc(db, 'trial_key', username), {
        username,
        passwordHash,
        active: true,
        durationHours: 24,
        createdAt: serverTimestamp(),
        activatedAt: null,
        createdBy: uid,
      });
    } else {
      await setDoc(doc(db, 'permanent', username), {
        username,
        passwordHash,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function toggleLicenseKeyActive(
  licenseType: LicenseType,
  keyId: string,
  active: boolean
): Promise<void> {
  const path = `${licenseType}/${keyId}`;
  try {
    await updateDoc(doc(db, licenseType, keyId), { active });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteLicenseKey(licenseType: LicenseType, keyId: string): Promise<void> {
  const path = `${licenseType}/${keyId}`;
  try {
    await deleteDoc(doc(db, licenseType, keyId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
