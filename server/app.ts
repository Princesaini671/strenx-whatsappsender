import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import Papa from 'papaparse';
import type { CountryCode } from 'libphonenumber-js';
import {
  addContactsBatch,
  clearAllContacts,
  clearDraftAttachment,
  createLocalBackup,
  deleteContactById,
  getAllSettings,
  getAnalyticsSnapshot,
  getBackupById,
  getDraft,
  getExistingPhoneSet,
  getPreviouslyMessagedSet,
  getSetting,
  isAttachmentUsedByCampaign,
  listContacts,
  saveDraftAttachment,
  saveDraftText,
  setSetting,
  setSettingsBulk,
} from './store.ts';
import { addSseClient } from './events.ts';
import { DATA_DIR, IS_VERCEL, UPLOADS_DIR, ensureDataDirectories } from './paths.ts';
import { getCountryOptions, processBatchPhoneLines } from './phone.ts';
import { whatsappManager } from './whatsapp.ts';
import { campaignRunner } from './campaign.ts';

const allowedAttachmentExts = new Set(['.jpg', '.jpeg', '.png', '.pdf', '.mp4']);

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDataDirectories();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = allowedAttachmentExts.has(ext) ? ext : '';
    const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    cb(null, unique);
  },
});

const attachmentUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedAttachmentExts.has(ext)) {
      cb(new Error('Only JPG, JPEG, PNG, PDF, and MP4 files are supported.'));
      return;
    }
    cb(null, true);
  },
});

const csvMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' && !file.mimetype.includes('csv') && !file.mimetype.includes('text')) {
      cb(new Error('Please upload a valid .csv file.'));
      return;
    }
    cb(null, true);
  },
});

function detectAttachmentType(ext: string, mime: string): 'image' | 'pdf' | 'video' {
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.mp4' || mime.startsWith('video/')) return 'video';
  return 'image';
}

let bootPromise: Promise<void> | null = null;

export function ensureBackendBootstrapped(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    ensureDataDirectories();

    if (getSetting('auto_backup_enabled') === '1') {
      const lastBackup = getSetting('last_backup_at');
      const lastMs = lastBackup ? Date.parse(lastBackup) : 0;
      if (!lastMs || Date.now() - lastMs > 6 * 60 * 60 * 1000) {
        await createLocalBackup('auto').catch(() => {});
      }
    }

    if (!IS_VERCEL) {
      void whatsappManager.initializeIfSessionExists();
    }
  })();
  return bootPromise;
}

export function createApiApp(): express.Express {
  ensureDataDirectories();
  const app = express();

  // CORS & JSON preflight support
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      app: 'Strenx WhatsApp Sender',
      runtime: IS_VERCEL ? 'vercel-serverless' : 'node',
    });
  });

  // Server-Sent Events stream
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    addSseClient(res);

    const waSnap = whatsappManager.getSnapshot();
    const campaign = campaignRunner.getActiveOrLatestCampaign();
    res.write(`event: whatsapp:status\ndata: ${JSON.stringify(waSnap)}\n\n`);
    if (campaign) {
      res.write(`event: campaign:update\ndata: ${JSON.stringify(campaign)}\n\n`);
    }

    if (IS_VERCEL) {
      // On Vercel serverless, send immediate snapshot and close cleanly so lambda does not hang
      res.end();
      return;
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  // WhatsApp connection endpoints
  app.get('/api/whatsapp/status', (_req, res) => {
    res.json(whatsappManager.getSnapshot());
  });

  app.post('/api/whatsapp/connect', async (_req, res, next) => {
    try {
      const snap = await whatsappManager.connectQR();
      res.json(snap);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/whatsapp/disconnect', async (_req, res, next) => {
    try {
      const snap = await whatsappManager.disconnect();
      res.json(snap);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/whatsapp/logout', async (_req, res, next) => {
    try {
      const snap = await whatsappManager.logout();
      res.json(snap);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/whatsapp/cloud-api', async (req, res, next) => {
    try {
      const { mode, phoneId, accessToken } = req.body as {
        mode?: 'qr' | 'cloud_api';
        phoneId?: string;
        accessToken?: string;
      };

      if (mode === 'qr') {
        setSetting('connection_mode', 'qr');
        res.json({ ok: true, status: whatsappManager.getSnapshot() });
        return;
      }

      if (!phoneId?.trim() || !accessToken?.trim()) {
        res.status(400).json({ ok: false, error: 'Phone Number ID and Access Token are required.' });
        return;
      }

      const check = await whatsappManager.verifyCloudApi(phoneId.trim(), accessToken.trim());
      if (!check.ok) {
        res.status(400).json({ ok: false, error: check.error || 'Failed to verify Cloud API credentials.' });
        return;
      }

      setSettingsBulk({
        connection_mode: 'cloud_api',
        cloud_api_phone_id: phoneId.trim(),
        cloud_api_token: accessToken.trim(),
      });

      res.json({
        ok: true,
        verifiedName: check.verifiedName,
        displayPhone: check.displayPhone,
        status: whatsappManager.getSnapshot(),
      });
    } catch (err) {
      next(err);
    }
  });

  // Countries
  app.get('/api/countries', (_req, res) => {
    res.json(getCountryOptions());
  });

  // Contacts / Phone numbers
  app.get('/api/contacts', (_req, res) => {
    const contacts = listContacts();
    const messagedSet = getPreviouslyMessagedSet();

    res.json({
      contacts: contacts.map((c) => ({
        ...c,
        previouslyMessaged: messagedSet.has(c.phone_e164),
      })),
      totalCount: contacts.length,
    });
  });

  app.post('/api/contacts/manual', (req, res) => {
    const { input, countryCode } = req.body as { input?: string; countryCode?: string };
    if (!input || !input.trim()) {
      res.status(400).json({ error: 'Enter at least one phone number.' });
      return;
    }

    const cc = (countryCode || getSetting('default_country_code') || 'US') as CountryCode;
    const lines = input
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const existing = getExistingPhoneSet();
    const parsed = processBatchPhoneLines(lines, cc, existing);
    const inserted = addContactsBatch(parsed.entries, 'manual');

    res.json({
      inserted,
      validCount: parsed.validCount,
      invalidCount: parsed.invalidCount,
      duplicateCount: parsed.duplicateCount,
      invalidEntries: parsed.entries.filter((e) => !e.isValid).slice(0, 25),
    });
  });

  app.post('/api/contacts/bulk-paste', (req, res) => {
    const { text, countryCode } = req.body as { text?: string; countryCode?: string };
    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Paste phone numbers (one per line).' });
      return;
    }

    const cc = (countryCode || getSetting('default_country_code') || 'US') as CountryCode;
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const existing = getExistingPhoneSet();
    const parsed = processBatchPhoneLines(lines, cc, existing);
    const inserted = addContactsBatch(parsed.entries, 'paste');

    res.json({
      totalLines: lines.length,
      inserted,
      validCount: parsed.validCount,
      invalidCount: parsed.invalidCount,
      duplicateCount: parsed.duplicateCount,
      invalidEntries: parsed.entries.filter((e) => !e.isValid).slice(0, 50),
    });
  });

  app.post('/api/contacts/csv/preview', csvMemoryUpload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'CSV file is required.' });
      return;
    }

    const csvText = req.file.buffer.toString('utf8');
    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const headers = parsed.meta.fields || [];
    if (headers.length === 0) {
      const rawLines = csvText
        .split(/\r?\n/)
        .map((l) => l.split(',')[0]?.trim() || '')
        .filter(Boolean);
      const cc = ((req.body?.countryCode as string) || getSetting('default_country_code') || 'US') as CountryCode;
      const existing = getExistingPhoneSet();
      const summary = processBatchPhoneLines(rawLines, cc, existing);
      res.json({
        hasHeaders: false,
        headers: ['Column 1'],
        selectedColumn: 'Column 1',
        totalRows: rawLines.length,
        validCount: summary.validCount,
        invalidCount: summary.invalidCount,
        duplicateCount: summary.duplicateCount,
        previewRows: summary.entries.slice(0, 100),
      });
      return;
    }

    const phoneHeader =
      headers.find((h) => /phone|mobile|whatsapp|number|tel|contact/i.test(h)) || headers[0];
    const requestedColumn = (req.body?.column as string) || phoneHeader;
    const activeColumn = headers.includes(requestedColumn) ? requestedColumn : phoneHeader;
    const cc = ((req.body?.countryCode as string) || getSetting('default_country_code') || 'US') as CountryCode;

    const columnValues = parsed.data
      .map((row) => String(row[activeColumn] ?? '').trim())
      .filter(Boolean);

    const existing = getExistingPhoneSet();
    const summary = processBatchPhoneLines(columnValues, cc, existing);

    res.json({
      hasHeaders: true,
      headers,
      selectedColumn: activeColumn,
      totalRows: columnValues.length,
      validCount: summary.validCount,
      invalidCount: summary.invalidCount,
      duplicateCount: summary.duplicateCount,
      previewRows: summary.entries.slice(0, 100),
    });
  });

  app.post('/api/contacts/csv/import', csvMemoryUpload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'CSV file is required.' });
      return;
    }

    const csvText = req.file.buffer.toString('utf8');
    const cc = ((req.body?.countryCode as string) || getSetting('default_country_code') || 'US') as CountryCode;
    const requestedColumn = req.body?.column as string | undefined;

    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    const headers = parsed.meta.fields || [];
    let values: string[] = [];

    if (headers.length === 0) {
      values = csvText
        .split(/\r?\n/)
        .map((l) => l.split(',')[0]?.trim() || '')
        .filter(Boolean);
    } else {
      const col =
        requestedColumn && headers.includes(requestedColumn)
          ? requestedColumn
          : headers.find((h) => /phone|mobile|whatsapp|number|tel|contact/i.test(h)) || headers[0];
      values = parsed.data.map((row) => String(row[col] ?? '').trim()).filter(Boolean);
    }

    const existing = getExistingPhoneSet();
    const summary = processBatchPhoneLines(values, cc, existing);
    const inserted = addContactsBatch(summary.entries, 'csv');

    res.json({
      totalRows: values.length,
      inserted,
      validCount: summary.validCount,
      invalidCount: summary.invalidCount,
      duplicateCount: summary.duplicateCount,
    });
  });

  app.delete('/api/contacts/:id', (req, res) => {
    deleteContactById(Number(req.params.id));
    res.json({ ok: true });
  });

  app.delete('/api/contacts', (_req, res) => {
    clearAllContacts();
    res.json({ ok: true });
  });

  // Draft Message & Attachments
  app.get('/api/draft', (_req, res) => {
    const draft = getDraft();
    res.json({
      ...draft,
      attachmentUrl: draft.attachment_path
        ? `/api/uploads/${path.basename(draft.attachment_path)}`
        : null,
    });
  });

  app.put('/api/draft', (req, res) => {
    const { bodyText } = req.body as { bodyText?: string };
    const draft = saveDraftText(bodyText ?? '');
    res.json({
      ...draft,
      attachmentUrl: draft.attachment_path
        ? `/api/uploads/${path.basename(draft.attachment_path)}`
        : null,
    });
  });

  app.post('/api/draft/attachment', attachmentUpload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Attachment file is required.' });
      return;
    }

    const prev = getDraft();
    if (prev.attachment_path && fs.existsSync(prev.attachment_path)) {
      if (!isAttachmentUsedByCampaign(prev.attachment_path)) {
        try {
          fs.unlinkSync(prev.attachment_path);
        } catch {
          // ignore
        }
      }
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const type = detectAttachmentType(ext, req.file.mimetype);

    const draft = saveDraftAttachment({
      attachmentPath: req.file.path,
      attachmentName: req.file.originalname,
      attachmentMime: req.file.mimetype,
      attachmentSize: req.file.size,
      attachmentType: type,
    });

    res.json({
      ...draft,
      attachmentUrl: `/api/uploads/${path.basename(req.file.path)}`,
    });
  });

  app.delete('/api/draft/attachment', (_req, res) => {
    const prev = getDraft();
    if (prev.attachment_path && fs.existsSync(prev.attachment_path)) {
      if (!isAttachmentUsedByCampaign(prev.attachment_path)) {
        try {
          fs.unlinkSync(prev.attachment_path);
        } catch {
          // ignore
        }
      }
    }

    const draft = clearDraftAttachment();
    res.json({ ...draft, attachmentUrl: null });
  });

  app.get('/api/uploads/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.sendFile(fullPath);
  });

  // Settings
  app.get('/api/settings', (_req, res) => {
    res.json(getAllSettings());
  });

  app.put('/api/settings', (req, res) => {
    const allowedKeys = [
      'interval_seconds',
      'batch_size',
      'batch_pause_seconds',
      'default_country_code',
      'skip_already_messaged',
      'auto_backup_enabled',
    ];
    const updates: Record<string, string> = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        updates[key] = String(req.body[key]);
      }
    }
    if (Object.keys(updates).length > 0) {
      setSettingsBulk(updates);
    }
    res.json(getAllSettings());
  });

  // Campaign Controls & Dashboard
  app.get('/api/campaign/current', (req, res) => {
    const campaign = campaignRunner.getActiveOrLatestCampaign();
    if (!campaign) {
      res.json({ campaign: null, messages: [] });
      return;
    }
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';
    const messages = campaignRunner.getCampaignMessages(campaign.id, 300, statusFilter);
    res.json({ campaign, messages });
  });

  app.post('/api/campaign/start', async (req, res) => {
    try {
      const { name, skipAlreadyMessaged } = req.body as {
        name?: string;
        skipAlreadyMessaged?: boolean;
      };
      const result = await campaignRunner.startCampaign({ name, skipAlreadyMessaged });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to start campaign' });
    }
  });

  app.post('/api/campaign/pause', async (_req, res) => {
    const campaign = await campaignRunner.pauseCampaign('Paused by user');
    res.json({ campaign });
  });

  app.post('/api/campaign/resume', async (_req, res) => {
    try {
      const campaign = await campaignRunner.resumeCampaign();
      res.json({ campaign });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to resume campaign' });
    }
  });

  app.post('/api/campaign/stop', async (_req, res) => {
    const campaign = await campaignRunner.stopCampaign();
    res.json({ campaign });
  });

  // Analytics & Local File Backups
  app.get('/api/analytics', (_req, res) => {
    const snapshot = getAnalyticsSnapshot();
    res.json({
      ...snapshot,
      dataDir: DATA_DIR,
    });
  });

  app.post('/api/backups/create', async (_req, res) => {
    try {
      const backup = await createLocalBackup('manual');
      res.json(backup);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Backup failed' });
    }
  });

  app.get('/api/backups/:id/download', (req, res) => {
    const id = Number(req.params.id);
    const row = getBackupById(id);
    if (!row || !fs.existsSync(row.file_path)) {
      res.status(404).json({ error: 'Backup file not found' });
      return;
    }
    res.download(row.file_path, row.filename);
  });

  // JSON error handler for multer / unexpected API errors
  app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Bad request' });
      return;
    }
    next();
  });

  // JSON 404 handler for unmatched /api routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return app;
}
