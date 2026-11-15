import fs from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR, STATE_FILE_PATH, ensureDataDirectories } from './paths.ts';

export interface ContactRow {
  id: number;
  raw_input: string;
  phone_e164: string;
  country_code: string | null;
  source: 'manual' | 'paste' | 'csv';
  is_valid: number;
  validation_error: string | null;
  created_at: string;
}

export interface DraftMessageRow {
  id: number;
  body_text: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_type: 'image' | 'pdf' | 'video' | null;
  updated_at: string;
}

export interface CampaignRow {
  id: number;
  name: string;
  message_text: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_type: string | null;
  interval_seconds: number;
  batch_size: number;
  batch_pause_seconds: number;
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'completed';
  total_count: number;
  submitted_count: number;
  delivered_count: number;
  failed_count: number;
  remaining_count: number;
  processing_count: number;
  current_phone: string | null;
  last_activity: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CampaignMessageRow {
  id: number;
  campaign_id: number;
  phone_e164: string;
  status: 'queued' | 'submitted' | 'delivered' | 'failed' | 'stopped';
  wa_message_id: string | null;
  error_message: string | null;
  attempts: number;
  processed_at: string | null;
  created_at: string;
}

export interface DailyStatRow {
  date: string;
  total_attempted: number;
  successful: number;
  failed: number;
}

export interface BackupRow {
  id: number;
  filename: string;
  file_path: string;
  size_bytes: number;
  trigger_type: 'auto' | 'manual';
  created_at: string;
}

interface PersistedState {
  nextIds: {
    contact: number;
    campaign: number;
    campaignMessage: number;
    backup: number;
  };
  settings: Record<string, string>;
  contacts: ContactRow[];
  draft: DraftMessageRow;
  campaigns: CampaignRow[];
  campaignMessages: CampaignMessageRow[];
  dailyStats: Record<string, DailyStatRow>;
  backups: BackupRow[];
}

const DEFAULT_SETTINGS: Record<string, string> = {
  interval_seconds: '30',
  batch_size: '10',
  batch_pause_seconds: '30',
  default_country_code: 'US',
  skip_already_messaged: '1',
  connection_mode: 'qr',
  cloud_api_phone_id: '',
  cloud_api_token: '',
  auto_backup_enabled: '1',
  last_backup_at: '',
};

function nowIsoNoZ(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function createInitialState(): PersistedState {
  return {
    nextIds: {
      contact: 1,
      campaign: 1,
      campaignMessage: 1,
      backup: 1,
    },
    settings: { ...DEFAULT_SETTINGS },
    contacts: [],
    draft: {
      id: 1,
      body_text: '',
      attachment_path: null,
      attachment_name: null,
      attachment_mime: null,
      attachment_size: null,
      attachment_type: null,
      updated_at: nowIsoNoZ(),
    },
    campaigns: [],
    campaignMessages: [],
    dailyStats: {},
    backups: [],
  };
}

function loadState(): PersistedState {
  ensureDataDirectories();
  if (!fs.existsSync(STATE_FILE_PATH)) {
    const fresh = createInitialState();
    saveState(fresh);
    return fresh;
  }

  try {
    const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    const fresh = createInitialState();
    return {
      nextIds: { ...fresh.nextIds, ...(parsed.nextIds || {}) },
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      draft: parsed.draft ? { ...fresh.draft, ...parsed.draft } : fresh.draft,
      campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
      campaignMessages: Array.isArray(parsed.campaignMessages) ? parsed.campaignMessages : [],
      dailyStats: parsed.dailyStats && typeof parsed.dailyStats === 'object' ? parsed.dailyStats : {},
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
    };
  } catch {
    const fresh = createInitialState();
    saveState(fresh);
    return fresh;
  }
}

function saveState(target: PersistedState): void {
  ensureDataDirectories();
  const tmpPath = `${STATE_FILE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2), 'utf8');
  fs.renameSync(tmpPath, STATE_FILE_PATH);
}

const state: PersistedState = loadState();

// Recover any interrupted running campaigns safely on boot
let recoveredOnBoot = false;
for (const c of state.campaigns) {
  if (c.status === 'running') {
    c.status = 'paused';
    c.processing_count = 0;
    c.current_phone = null;
    c.last_activity = 'Paused automatically after application restart — click Resume to continue';
    recoveredOnBoot = true;
  }
}
if (recoveredOnBoot) {
  saveState(state);
}

export function getAllSettings(): Record<string, string> {
  return { ...DEFAULT_SETTINGS, ...state.settings };
}

export function getSetting(key: string): string {
  return state.settings[key] ?? DEFAULT_SETTINGS[key] ?? '';
}

export function setSetting(key: string, value: string): void {
  state.settings[key] = value;
  saveState(state);
}

export function setSettingsBulk(updates: Record<string, string>): void {
  for (const [k, v] of Object.entries(updates)) {
    state.settings[k] = v;
  }
  saveState(state);
}

export function listContacts(): ContactRow[] {
  return [...state.contacts].sort((a, b) => b.id - a.id);
}

export function getExistingPhoneSet(): Set<string> {
  return new Set(state.contacts.map((c) => c.phone_e164));
}

export function getValidContactPhones(): string[] {
  return state.contacts.filter((c) => c.is_valid === 1).map((c) => c.phone_e164);
}

export function addContactsBatch(
  entries: Array<{ raw: string; e164: string | null; countryCode: string | null; isValid: boolean; isDuplicate?: boolean }>,
  source: 'manual' | 'paste' | 'csv'
): number {
  const existing = getExistingPhoneSet();
  let inserted = 0;
  const createdAt = nowIsoNoZ();

  for (const entry of entries) {
    if (!entry.isValid || entry.isDuplicate || !entry.e164) continue;
    if (existing.has(entry.e164)) continue;

    existing.add(entry.e164);
    state.contacts.push({
      id: state.nextIds.contact++,
      raw_input: entry.raw,
      phone_e164: entry.e164,
      country_code: entry.countryCode,
      source,
      is_valid: 1,
      validation_error: null,
      created_at: createdAt,
    });
    inserted++;
  }

  if (inserted > 0) {
    saveState(state);
  }
  return inserted;
}

export function deleteContactById(id: number): void {
  const next = state.contacts.filter((c) => c.id !== id);
  if (next.length !== state.contacts.length) {
    state.contacts = next;
    saveState(state);
  }
}

export function clearAllContacts(): void {
  state.contacts = [];
  saveState(state);
}

export function getPreviouslyMessagedSet(): Set<string> {
  const result = new Set<string>();
  for (const msg of state.campaignMessages) {
    if (msg.status === 'submitted' || msg.status === 'delivered') {
      result.add(msg.phone_e164);
    }
  }
  return result;
}

export function getDraft(): DraftMessageRow {
  return { ...state.draft };
}

export function saveDraftText(bodyText: string): DraftMessageRow {
  state.draft.body_text = bodyText;
  state.draft.updated_at = nowIsoNoZ();
  saveState(state);
  return { ...state.draft };
}

export function saveDraftAttachment(payload: {
  attachmentPath: string;
  attachmentName: string;
  attachmentMime: string;
  attachmentSize: number;
  attachmentType: 'image' | 'pdf' | 'video';
}): DraftMessageRow {
  state.draft.attachment_path = payload.attachmentPath;
  state.draft.attachment_name = payload.attachmentName;
  state.draft.attachment_mime = payload.attachmentMime;
  state.draft.attachment_size = payload.attachmentSize;
  state.draft.attachment_type = payload.attachmentType;
  state.draft.updated_at = nowIsoNoZ();
  saveState(state);
  return { ...state.draft };
}

export function clearDraftAttachment(): DraftMessageRow {
  state.draft.attachment_path = null;
  state.draft.attachment_name = null;
  state.draft.attachment_mime = null;
  state.draft.attachment_size = null;
  state.draft.attachment_type = null;
  state.draft.updated_at = nowIsoNoZ();
  saveState(state);
  return { ...state.draft };
}

export function isAttachmentUsedByCampaign(filePath: string): boolean {
  return state.campaigns.some((c) => c.attachment_path === filePath);
}

export function getActiveRunningOrPausedCampaign(): CampaignRow | undefined {
  for (let i = state.campaigns.length - 1; i >= 0; i--) {
    const c = state.campaigns[i];
    if (c.status === 'running' || c.status === 'paused') return c;
  }
  return undefined;
}

export function getActiveCampaignByStatus(status: 'running' | 'paused'): CampaignRow | undefined {
  for (let i = state.campaigns.length - 1; i >= 0; i--) {
    if (state.campaigns[i].status === status) return state.campaigns[i];
  }
  return undefined;
}

export function getActiveOrLatestCampaign(): CampaignRow | null {
  const active = getActiveRunningOrPausedCampaign();
  if (active) return active;
  if (state.campaigns.length === 0) return null;
  return state.campaigns[state.campaigns.length - 1];
}

export function getCampaignById(campaignId: number): CampaignRow | undefined {
  return state.campaigns.find((c) => c.id === campaignId);
}

export function createCampaignWithRecipients(
  input: {
    name: string;
    message_text: string;
    attachment_path: string | null;
    attachment_name: string | null;
    attachment_mime: string | null;
    attachment_type: string | null;
    interval_seconds: number;
    batch_size: number;
    batch_pause_seconds: number;
    last_activity: string;
  },
  recipients: string[]
): CampaignRow {
  const now = nowIsoNoZ();
  const campaign: CampaignRow = {
    id: state.nextIds.campaign++,
    name: input.name,
    message_text: input.message_text,
    attachment_path: input.attachment_path,
    attachment_name: input.attachment_name,
    attachment_mime: input.attachment_mime,
    attachment_type: input.attachment_type,
    interval_seconds: input.interval_seconds,
    batch_size: input.batch_size,
    batch_pause_seconds: input.batch_pause_seconds,
    status: 'running',
    total_count: recipients.length,
    submitted_count: 0,
    delivered_count: 0,
    failed_count: 0,
    remaining_count: recipients.length,
    processing_count: 0,
    current_phone: null,
    last_activity: input.last_activity,
    started_at: now,
    completed_at: null,
    created_at: now,
  };

  state.campaigns.push(campaign);

  const seen = new Set<string>();
  for (const phone of recipients) {
    if (seen.has(phone)) continue;
    seen.add(phone);
    state.campaignMessages.push({
      id: state.nextIds.campaignMessage++,
      campaign_id: campaign.id,
      phone_e164: phone,
      status: 'queued',
      wa_message_id: null,
      error_message: null,
      attempts: 0,
      processed_at: null,
      created_at: now,
    });
  }

  saveState(state);
  return recalculateCampaignCounts(campaign.id)!;
}

export function updateCampaignFields(
  campaignId: number,
  updates: Partial<CampaignRow>
): CampaignRow | undefined {
  const campaign = state.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return undefined;
  Object.assign(campaign, updates);
  saveState(state);
  return campaign;
}

export function getNextQueuedMessage(campaignId: number): CampaignMessageRow | undefined {
  return state.campaignMessages.find((m) => m.campaign_id === campaignId && m.status === 'queued');
}

export function updateCampaignMessageFields(
  messageId: number,
  updates: Partial<CampaignMessageRow>
): CampaignMessageRow | undefined {
  const msg = state.campaignMessages.find((m) => m.id === messageId);
  if (!msg) return undefined;
  Object.assign(msg, updates);
  saveState(state);
  return msg;
}

export function findCampaignMessageByWaId(waMessageId: string): CampaignMessageRow | undefined {
  return state.campaignMessages.find((m) => m.wa_message_id === waMessageId);
}

export function stopQueuedMessagesForCampaign(campaignId: number): void {
  const now = nowIsoNoZ();
  for (const msg of state.campaignMessages) {
    if (msg.campaign_id === campaignId && msg.status === 'queued') {
      msg.status = 'stopped';
      msg.processed_at = now;
    }
  }
  saveState(state);
}

export function listCampaignMessages(
  campaignId: number,
  limit = 300,
  statusFilter = 'all'
): CampaignMessageRow[] {
  const filtered = state.campaignMessages.filter(
    (m) => m.campaign_id === campaignId && (statusFilter === 'all' || m.status === statusFilter)
  );
  return filtered.slice(0, limit);
}

export function recalculateCampaignCounts(campaignId: number): CampaignRow | undefined {
  const campaign = state.campaigns.find((c) => c.id === campaignId);
  if (!campaign) return undefined;

  let total = 0;
  let submitted = 0;
  let delivered = 0;
  let failed = 0;
  let queued = 0;

  for (const msg of state.campaignMessages) {
    if (msg.campaign_id !== campaignId) continue;
    total++;
    if (msg.status === 'submitted') submitted++;
    else if (msg.status === 'delivered') delivered++;
    else if (msg.status === 'failed') failed++;
    else if (msg.status === 'queued') queued++;
  }

  campaign.total_count = total;
  campaign.submitted_count = submitted;
  campaign.delivered_count = delivered;
  campaign.failed_count = failed;
  campaign.remaining_count = queued;

  saveState(state);
  return { ...campaign };
}

export function incrementDailyStat(
  dateStr: string,
  fields: { attempted?: number; successful?: number; failed?: number }
): void {
  if (!state.dailyStats[dateStr]) {
    state.dailyStats[dateStr] = {
      date: dateStr,
      total_attempted: 0,
      successful: 0,
      failed: 0,
    };
  }
  const row = state.dailyStats[dateStr];
  row.total_attempted += fields.attempted ?? 0;
  row.successful += fields.successful ?? 0;
  row.failed += fields.failed ?? 0;
  saveState(state);
}

export function getAnalyticsSnapshot() {
  let total = 0;
  let delivered = 0;
  let submitted = 0;
  let failed = 0;
  let remaining = 0;

  for (const msg of state.campaignMessages) {
    total++;
    if (msg.status === 'delivered') delivered++;
    else if (msg.status === 'submitted') submitted++;
    else if (msg.status === 'failed') failed++;
    else if (msg.status === 'queued') remaining++;
  }

  const finalized = delivered + failed;
  const successPercentage = finalized > 0 ? Number(((delivered / finalized) * 100).toFixed(1)) : 0;
  const failurePercentage = finalized > 0 ? Number(((failed / finalized) * 100).toFixed(1)) : 0;

  const campaigns = [...state.campaigns].sort((a, b) => b.id - a.id).slice(0, 30);
  const dailyStats = Object.values(state.dailyStats)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  const backups = [...state.backups].sort((a, b) => b.id - a.id).slice(0, 15);

  return {
    summary: {
      totalMessages: total,
      successfulMessages: delivered,
      submittedMessages: submitted,
      failedMessages: failed,
      remainingMessages: remaining,
      successPercentage,
      failurePercentage,
    },
    campaigns,
    dailyStats,
    backups,
  };
}

export async function createLocalBackup(triggerType: 'auto' | 'manual' = 'auto'): Promise<BackupRow> {
  ensureDataDirectories();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `strenx-backup-${stamp}.json`;
  const targetPath = path.join(BACKUPS_DIR, filename);

  saveState(state);
  const content = JSON.stringify(state, null, 2);
  fs.writeFileSync(targetPath, content, 'utf8');
  const stat = fs.statSync(targetPath);

  const record: BackupRow = {
    id: state.nextIds.backup++,
    filename,
    file_path: targetPath,
    size_bytes: stat.size,
    trigger_type: triggerType,
    created_at: nowIsoNoZ(),
  };

  state.backups.push(record);
  state.settings.last_backup_at = new Date().toISOString();

  // Keep latest 15 backups on disk
  if (state.backups.length > 15) {
    const sortedDesc = [...state.backups].sort((a, b) => b.id - a.id);
    const keep = sortedDesc.slice(0, 15);
    const drop = sortedDesc.slice(15);
    for (const old of drop) {
      try {
        if (fs.existsSync(old.file_path)) {
          fs.unlinkSync(old.file_path);
        }
      } catch {
        // ignore cleanup error
      }
    }
    state.backups = keep;
  }

  saveState(state);
  return record;
}

export function getBackupById(id: number): BackupRow | undefined {
  return state.backups.find((b) => b.id === id);
}

export function flushStoreToDisk(): void {
  saveState(state);
}

export function stampNow(): string {
  return nowIsoNoZ();
}
