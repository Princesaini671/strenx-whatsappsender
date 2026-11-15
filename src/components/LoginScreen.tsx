import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  Infinity as InfinityIcon,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import {
  createLicenseKey,
  deleteLicenseKey,
  listAllLicenseKeys,
  loginWithFirebaseCollections,
  signInAdminWithGoogle,
  signOutAdmin,
  toggleLicenseKeyActive,
  type ActiveLicenseSession,
  type LicenseType,
  type ManagedKeyRecord,
} from '../auth/licenseService.ts';
import { auth, testFirestoreConnection } from '../firebase.ts';

interface LoginScreenProps {
  notice?: string | null;
  onAuthenticated: (session: ActiveLicenseSession) => void;
}

function formatRemaining(expiresAtMs: number | null): string {
  if (!expiresAtMs) return 'Not activated yet (24h starts on first login)';
  const diff = expiresAtMs - Date.now();
  if (diff <= 0) return 'Expired';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m left`;
}

export function LoginScreen({ notice, onAuthenticated }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(notice || null);
  const [offlineWarning, setOfflineWarning] = useState(false);

  // Admin Key Manager panel state
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminUser, setAdminUser] = useState<User | null>(auth.currentUser);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);
  const [keys, setKeys] = useState<ManagedKeyRecord[]>([]);

  // New key form
  const [newKeyType, setNewKeyType] = useState<LicenseType>('trial_key');
  const [newKeyUsername, setNewKeyUsername] = useState('');
  const [newKeyPassword, setNewKeyPassword] = useState('');

  useEffect(() => {
    setErrorMsg(notice || null);
  }, [notice]);

  useEffect(() => {
    void testFirestoreConnection().then((res) => {
      if (res.offline) setOfflineWarning(true);
    });

    const unsub = onAuthStateChanged(auth, (user) => {
      setAdminUser(user);
    });
    return () => unsub();
  }, []);

  const loadKeys = async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      const list = await listAllLicenseKeys();
      setKeys(list);
    } catch (err) {
      setAdminError(
        err instanceof Error
          ? err.message
          : 'Unable to load keys. Sign in with the authorized admin Google account.'
      );
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (showAdminPanel && adminUser) {
      void loadKeys();
    }
  }, [showAdminPanel, adminUser]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const session = await loginWithFirebaseCollections(username, password);
      onAuthenticated(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed.';
      setErrorMsg(
        msg.startsWith('{')
          ? 'Unable to verify credentials against Firebase. Check your connection or permissions.'
          : msg
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminGoogleSignIn = async () => {
    setAdminError(null);
    setAdminSuccess(null);
    try {
      await signInAdminWithGoogle();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setAdminError(null);
    setAdminSuccess(null);
    try {
      await createLicenseKey({
        licenseType: newKeyType,
        username: newKeyUsername,
        password: newKeyPassword,
      });
      setAdminSuccess(
        `Created ${newKeyType === 'trial_key' ? '24-hour trial' : 'permanent'} account "${newKeyUsername.trim()}".`
      );
      setNewKeyUsername('');
      setNewKeyPassword('');
      await loadKeys();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to create key.');
    } finally {
      setAdminLoading(false);
    }
  };

  const handleToggleActive = async (item: ManagedKeyRecord) => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      await toggleLicenseKeyActive(item.licenseType, item.id, !item.active);
      await loadKeys();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setAdminLoading(false);
    }
  };

  const handleDeleteKey = async (item: ManagedKeyRecord) => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      await deleteLicenseKey(item.licenseType, item.id);
      await loadKeys();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to delete key.');
    } finally {
      setAdminLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#0F1D17] flex flex-col items-center justify-center p-6">
      <div className={showAdminPanel ? 'w-full max-w-4xl space-y-6' : 'w-full max-w-md space-y-6'}>
        {/* Brand Lockup */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#0D8A4E] text-white">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.1">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[#0F1D17]">
            Strenx WhatsApp Sender
          </h1>
          <p className="text-sm text-[#475A51]">
            {showAdminPanel
              ? 'Manage 24-hour trial keys and permanent accounts in Firebase Firestore'
              : 'Enter your username and password to access the desktop workspace'}
          </p>
        </div>

        {offlineWarning && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <span>
              Firebase Firestore appears offline. An active internet connection is required to verify credentials.
            </span>
          </div>
        )}

        {!showAdminPanel ? (
          <form
            onSubmit={handleLogin}
            className="rounded-xl border border-[#E2E8E4] bg-white p-7 space-y-5"
          >
            {errorMsg && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="login-username" className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#73857C]" />
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="w-full rounded-lg border border-[#D4DDD8] bg-white pl-10 pr-3.5 py-2.5 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#73857C]" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-lg border border-[#D4DDD8] bg-white pl-10 pr-10 py-2.5 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#73857C] hover:text-[#0F1D17] cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign In
            </button>

            <div className="border-t border-[#EEF2EF] pt-4 flex items-center justify-between text-xs text-[#73857C]">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#0D8A4E]" />
                Trial: 24h · Permanent: Lifetime
              </span>
              <button
                type="button"
                onClick={() => setShowAdminPanel(true)}
                className="font-medium text-[#0D8A4E] hover:underline cursor-pointer"
              >
                Manage Keys
              </button>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-5 w-5 text-[#0D8A4E]" />
                <div>
                  <h2 className="text-sm font-semibold text-[#0F1D17]">
                    Firebase License Key Manager
                  </h2>
                  <p className="text-xs text-[#73857C]">
                    Collections: <span className="font-mono">trial_key</span> (24h) ·{' '}
                    <span className="font-mono">permanent</span> (lifetime)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {adminUser && (
                  <>
                    <span className="text-xs text-[#475A51]">{adminUser.email}</span>
                    <button
                      type="button"
                      onClick={() => void signOutAdmin()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4DDD8] px-3 py-1.5 text-xs font-medium text-[#475A51] hover:text-[#0F1D17] cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Admin Sign Out
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowAdminPanel(false)}
                  className="rounded-lg bg-[#EDF2EF] px-3.5 py-1.5 text-xs font-medium text-[#0F1D17] hover:bg-[#E2E8E4] cursor-pointer"
                >
                  Back to Login
                </button>
              </div>
            </div>

            {!adminUser ? (
              <div className="py-8 text-center space-y-4">
                <KeyRound className="mx-auto h-10 w-10 text-[#0D8A4E]" />
                <div>
                  <p className="text-sm font-semibold text-[#0F1D17]">
                    Admin Google Sign-In Required
                  </p>
                  <p className="mt-1 text-xs text-[#475A51] max-w-md mx-auto">
                    Sign in with your administrator Google account to create, enable, disable, or delete keys in the <span className="font-mono">trial_key</span> and <span className="font-mono">permanent</span> Firestore collections.
                  </p>
                </div>
                {adminError && (
                  <p className="text-xs text-red-600">{adminError}</p>
                )}
                <button
                  type="button"
                  onClick={handleAdminGoogleSignIn}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0A6E3E] cursor-pointer"
                >
                  Sign In with Google
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {adminError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                    {adminError}
                  </div>
                )}
                {adminSuccess && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900">
                    {adminSuccess}
                  </div>
                )}

                {/* Create New Key Form */}
                <form
                  onSubmit={handleCreateKey}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-12 items-end rounded-lg border border-[#E2E8E4] bg-[#F8FAF9] p-4"
                >
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-[#0F1D17] mb-1">
                      Collection Type
                    </label>
                    <select
                      value={newKeyType}
                      onChange={(e) => setNewKeyType(e.target.value as LicenseType)}
                      className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 text-xs text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                    >
                      <option value="trial_key">trial_key (24 Hours Only)</option>
                      <option value="permanent">permanent (Lifetime)</option>
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-[#0F1D17] mb-1">
                      Username (Doc ID)
                    </label>
                    <input
                      type="text"
                      required
                      value={newKeyUsername}
                      onChange={(e) => setNewKeyUsername(e.target.value)}
                      placeholder="e.g. client_01"
                      className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 font-mono text-xs text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-[#0F1D17] mb-1">
                      Password
                    </label>
                    <input
                      type="text"
                      required
                      value={newKeyPassword}
                      onChange={(e) => setNewKeyPassword(e.target.value)}
                      placeholder="Min 4 chars"
                      className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 font-mono text-xs text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={adminLoading}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0D8A4E] px-4 py-2 text-xs font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create Key
                    </button>
                  </div>
                </form>

                {/* Keys Table */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-[#0F1D17]">
                      Existing Accounts ({keys.length})
                    </h3>
                    <button
                      type="button"
                      onClick={() => void loadKeys()}
                      disabled={adminLoading}
                      className="inline-flex items-center gap-1.5 text-xs text-[#0D8A4E] hover:underline cursor-pointer"
                    >
                      <RefreshCw className={`h-3 w-3 ${adminLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>

                  {keys.length === 0 ? (
                    <p className="py-6 text-center text-xs text-[#73857C]">
                      No keys found yet. Create a 24-hour trial or permanent key above.
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-auto rounded-lg border border-[#E2E8E4]">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-[#F6F8F7] text-[#475A51] border-b border-[#E2E8E4]">
                          <tr>
                            <th className="px-4 py-2 font-medium">Username</th>
                            <th className="px-4 py-2 font-medium">Collection</th>
                            <th className="px-4 py-2 font-medium">Validity</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EEF2EF]">
                          {keys.map((item) => (
                            <tr key={`${item.licenseType}-${item.id}`} className="hover:bg-[#F8FAF9]">
                              <td className="px-4 py-2 font-mono font-medium text-[#0F1D17]">
                                {item.username}
                              </td>
                              <td className="px-4 py-2">
                                {item.licenseType === 'permanent' ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-[#0D8A4E]">
                                    <InfinityIcon className="h-3.5 w-3.5" />
                                    permanent
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                    <Clock className="h-3.5 w-3.5" />
                                    trial_key (24h)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 font-mono text-[#475A51] tabular-nums">
                                {item.licenseType === 'permanent'
                                  ? 'Permanent'
                                  : formatRemaining(item.expiresAtMs)}
                              </td>
                              <td className="px-4 py-2">
                                <button
                                  type="button"
                                  onClick={() => void handleToggleActive(item)}
                                  className={`font-medium cursor-pointer ${
                                    item.active ? 'text-[#0D8A4E]' : 'text-red-600'
                                  }`}
                                >
                                  {item.active ? 'Active' : 'Disabled'}
                                </button>
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteKey(item)}
                                  aria-label={`Delete ${item.username}`}
                                  className="inline-flex items-center justify-center rounded p-1 text-[#73857C] hover:bg-red-50 hover:text-red-600 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
