import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { BACKUPS_DIR, DB_PATH, ensureDataDirectories } from './paths.ts';

ensureDataDirectories();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_input TEXT NOT NULL,
    phone_e164 TEXT NOT NULL UNIQUE,
    country_code TEXT,
    source TEXT NOT NULL CHECK(source IN ('manual', 'paste', 'csv')),
    is_valid INTEGER NOT NULL DEFAULT 1,
    validation_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS draft_message (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    body_text TEXT NOT NULL DEFAULT '',
    attachment_path TEXT,
    attachment_name TEXT,
    attachment_mime TEXT,
    attachment_size INTEGER,
    attachment_type TEXT CHECK(attachment_type IN ('image', 'pdf', 'video')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message_text TEXT NOT NULL DEFAULT '',
    attachment_path TEXT,
    attachment_name TEXT,
    attachment_mime TEXT,
    attachment_type TEXT,
    interval_seconds INTEGER NOT NULL DEFAULT 30,
    batch_size INTEGER NOT NULL DEFAULT 10,
    batch_pause_seconds INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL CHECK(status IN ('idle', 'running', 'paused', 'stopped', 'completed')),
    total_count INTEGER NOT NULL DEFAULT 0,
    submitted_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    remaining_count INTEGER NOT NULL DEFAULT 0,
    processing_count INTEGER NOT NULL DEFAULT 0,
    current_phone TEXT,
    last_activity TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaign_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    phone_e164 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'submitted', 'delivered', 'failed', 'stopped')),
    wa_message_id TEXT,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(campaign_id, phone_e164)
  );

  CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_status
    ON campaign_messages(campaign_id, status);

  CREATE INDEX IF NOT EXISTS idx_campaign_messages_wa_id
    ON campaign_messages(wa_message_id);

  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    total_attempted INTEGER NOT NULL DEFAULT 0,
    successful INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('auto', 'manual')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed singleton draft row if missing
db.prepare(`INSERT OR IGNORE INTO draft_message (id, body_text) VALUES (1, '')`).run();

// Seed default settings with conservative messaging pace
const defaultSettings: Record<string, string> = {
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

const insertSettingStmt = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
for (const [k, v] of Object.entries(defaultSettings)) {
  insertSettingStmt.run(k, v);
}

// Recover any interrupted running campaign safely on boot
db.prepare(`
  UPDATE campaigns
  SET status = 'paused',
      processing_count = 0,
      current_phone = NULL,
      last_activity = 'Paused automatically after application restart — click Resume to continue'
  WHERE status = 'running'
`).run();

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = { ...defaultSettings };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function getSetting(key: string): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row ? row.value : (defaultSettings[key] ?? '');
}

export function setSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function setSettingsBulk(updates: Record<string, string>): void {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((entries: Array<[string, string]>) => {
    for (const [k, v] of entries) {
      upsert.run(k, v);
    }
  });
  tx(Object.entries(updates));
}

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

export interface BackupRow {
  id: number;
  filename: string;
  file_path: string;
  size_bytes: number;
  trigger_type: 'auto' | 'manual';
  created_at: string;
}

export function recalculateCampaignCounts(campaignId: number): CampaignRow | undefined {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued
    FROM campaign_messages
    WHERE campaign_id = ?
  `).get(campaignId) as {
    total: number;
    submitted: number | null;
    delivered: number | null;
    failed: number | null;
    queued: number | null;
  };

  db.prepare(`
    UPDATE campaigns
    SET total_count = ?,
        submitted_count = ?,
        delivered_count = ?,
        failed_count = ?,
        remaining_count = ?
    WHERE id = ?
  `).run(
    counts.total || 0,
    counts.submitted || 0,
    counts.delivered || 0,
    counts.failed || 0,
    counts.queued || 0,
    campaignId
  );

  return db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId) as CampaignRow | undefined;
}

export function incrementDailyStat(dateStr: string, fields: { attempted?: number; successful?: number; failed?: number }): void {
  db.prepare(`
    INSERT INTO daily_stats (date, total_attempted, successful, failed)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_attempted = daily_stats.total_attempted + excluded.total_attempted,
      successful = daily_stats.successful + excluded.successful,
      failed = daily_stats.failed + excluded.failed
  `).run(
    dateStr,
    fields.attempted ?? 0,
    fields.successful ?? 0,
    fields.failed ?? 0
  );
}

export async function createLocalBackup(triggerType: 'auto' | 'manual' = 'auto'): Promise<BackupRow> {
  ensureDataDirectories();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `strenx-backup-${stamp}.db`;
  const targetPath = path.join(BACKUPS_DIR, filename);

  await db.backup(targetPath);
  const stat = fs.statSync(targetPath);

  const info = db.prepare(`
    INSERT INTO backups (filename, file_path, size_bytes, trigger_type)
    VALUES (?, ?, ?, ?)
  `).run(filename, targetPath, stat.size, triggerType);

  setSetting('last_backup_at', new Date().toISOString());

  // Keep latest 15 backups on disk
  const oldRows = db.prepare(`
    SELECT id, file_path FROM backups ORDER BY id DESC LIMIT -1 OFFSET 15
  `).all() as Array<{ id: number; file_path: string }>;

  for (const old of oldRows) {
    try {
      if (fs.existsSync(old.file_path)) {
        fs.unlinkSync(old.file_path);
      }
    } catch {
      // ignore cleanup error
    }
    db.prepare(`DELETE FROM backups WHERE id = ?`).run(old.id);
  }

  return db.prepare(`SELECT * FROM backups WHERE id = ?`).get(info.lastInsertRowid) as BackupRow;
}
