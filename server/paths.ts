import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

export const DATA_DIR = process.env.STRENX_DATA_DIR
  ? path.resolve(process.env.STRENX_DATA_DIR)
  : IS_VERCEL
  ? path.join(os.tmpdir(), 'strenx-whatsapp-sender-data')
  : path.resolve(process.cwd(), 'data');

export const STATE_FILE_PATH = path.join(DATA_DIR, 'strenx-data.json');
export const SESSION_DIR = path.join(DATA_DIR, 'wa-session');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

export function ensureDataDirectories(): void {
  for (const dir of [DATA_DIR, UPLOADS_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  }
}
