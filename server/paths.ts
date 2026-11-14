import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.STRENX_DATA_DIR
  ? path.resolve(process.env.STRENX_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const DB_PATH = path.join(DATA_DIR, 'strenx.db');
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
