import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import {
  db,
  getAllSettings,
  incrementDailyStat,
  recalculateCampaignCounts,
  setSetting,
} from './db.ts';
import { broadcastEvent } from './events.ts';
import { SESSION_DIR, ensureDataDirectories } from './paths.ts';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'connected';

export interface WhatsAppStatusSnapshot {
  mode: 'qr' | 'cloud_api';
  state: ConnectionState;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  hasSavedSession: boolean;
  lastError: string | null;
  updatedAt: string;
}

export interface SendPayload {
  text: string;
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentType?: 'image' | 'pdf' | 'video' | null;
}

export interface SendResult {
  waMessageId: string;
  status: 'submitted' | 'delivered';
}

const logger = pino({ level: 'silent' });

class WhatsAppManager {
  private sock: WASocket | null = null;
  private state: ConnectionState = 'disconnected';
  private qrDataUrl: string | null = null;
  private phoneNumber: string | null = null;
  private displayName: string | null = null;
  private lastError: string | null = null;
  private manualDisconnect = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private onUnexpectedDisconnectCallback: ((reason: string) => void) | null = null;

  public setOnUnexpectedDisconnect(cb: (reason: string) => void): void {
    this.onUnexpectedDisconnectCallback = cb;
  }

  public hasSavedSession(): boolean {
    ensureDataDirectories();
    const credsPath = path.join(SESSION_DIR, 'creds.json');
    return fs.existsSync(credsPath);
  }

  public getSnapshot(): WhatsAppStatusSnapshot {
    const settings = getAllSettings();
    const mode = settings.connection_mode === 'cloud_api' ? 'cloud_api' : 'qr';
    return {
      mode,
      state: mode === 'cloud_api' && settings.cloud_api_phone_id && settings.cloud_api_token
        ? 'connected'
        : this.state,
      qrDataUrl: this.qrDataUrl,
      phoneNumber:
        mode === 'cloud_api' && settings.cloud_api_phone_id
          ? `Cloud API (${settings.cloud_api_phone_id})`
          : this.phoneNumber,
      displayName:
        mode === 'cloud_api' && settings.cloud_api_phone_id
          ? 'WhatsApp Cloud API'
          : this.displayName,
      hasSavedSession: this.hasSavedSession(),
      lastError: this.lastError,
      updatedAt: new Date().toISOString(),
    };
  }

  private emitStatus(): void {
    broadcastEvent('whatsapp:status', this.getSnapshot());
  }

  public async initializeIfSessionExists(): Promise<void> {
    const settings = getAllSettings();
    if (settings.connection_mode === 'qr' && this.hasSavedSession()) {
      await this.connectQR().catch(() => {
        // Silent boot restore failure; user can reconnect manually
      });
    }
  }

  public async connectQR(): Promise<WhatsAppStatusSnapshot> {
    if (this.isConnecting) {
      return this.getSnapshot();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.manualDisconnect = false;
    this.isConnecting = true;
    this.lastError = null;
    this.qrDataUrl = null;
    this.state = 'connecting';
    setSetting('connection_mode', 'qr');
    this.emitStatus();

    try {
      // Clean up any stale socket
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.ev.removeAllListeners('messages.update');
          this.sock.end(undefined);
        } catch {
          // ignore
        }
        this.sock = null;
      }

      ensureDataDirectories();
      const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

      let version: [number, number, number] | undefined;
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        version = undefined;
      }

      const sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: authState,
        logger,
        browser: Browsers.windows('Desktop'),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 30000,
      });

      this.sock = sock;

      sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch {
          // ignore
        }
      });

      sock.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          const msgId = update.key?.id;
          const status = update.update?.status;
          if (!msgId || typeof status !== 'number') continue;

          // Baileys WAMessageStatus: 2 = SERVER_ACK, 3 = DELIVERY_ACK, 4 = READ, 5 = PLAYED
          if (status >= 3) {
            this.handleDeliveryAck(msgId);
          }
        }
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 300,
              margin: 2,
              color: {
                dark: '#0F1D17',
                light: '#FFFFFF',
              },
            });
            this.state = 'qr_ready';
            this.lastError = null;
            this.emitStatus();
          } catch (err) {
            this.lastError = err instanceof Error ? err.message : 'Failed to render QR code';
            this.emitStatus();
          }
        }

        if (connection === 'open') {
          this.isConnecting = false;
          this.qrDataUrl = null;
          this.state = 'connected';
          this.lastError = null;
          const rawId = sock.user?.id || '';
          const phone = rawId.split(':')[0]?.split('@')[0] || '';
          this.phoneNumber = phone ? `+${phone}` : null;
          this.displayName = sock.user?.name || 'WhatsApp Linked Device';
          this.emitStatus();
        }

        if (connection === 'close') {
          this.isConnecting = false;
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
            ?.output?.statusCode;
          const errorMessage =
            (lastDisconnect?.error as Error | undefined)?.message || 'Connection closed';

          const isLoggedOut =
            statusCode === DisconnectReason.loggedOut || statusCode === 401;

          if (this.manualDisconnect) {
            this.state = 'disconnected';
            this.qrDataUrl = null;
            this.phoneNumber = null;
            this.displayName = null;
            this.emitStatus();
            return;
          }

          if (isLoggedOut) {
            this.clearSessionFiles();
            this.state = 'disconnected';
            this.qrDataUrl = null;
            this.phoneNumber = null;
            this.displayName = null;
            this.lastError = 'WhatsApp session logged out. Scan a new QR code to reconnect.';
            this.emitStatus();
            this.onUnexpectedDisconnectCallback?.(this.lastError);
            return;
          }

          // Stream restart required (515) happens right after QR pairing; reconnect immediately
          const shouldReconnectImmediately =
            statusCode === DisconnectReason.restartRequired || statusCode === 515;

          this.state = 'connecting';
          this.qrDataUrl = null;
          this.lastError = shouldReconnectImmediately
            ? null
            : `Reconnecting after disconnect (${errorMessage})`;
          this.emitStatus();

          if (!shouldReconnectImmediately) {
            this.onUnexpectedDisconnectCallback?.('WhatsApp connection dropped; reconnecting');
          }

          this.reconnectTimer = setTimeout(() => {
            this.connectQR().catch(() => {
              this.state = 'disconnected';
              this.lastError = 'Unable to reconnect to WhatsApp servers. Click Reconnect to try again.';
              this.emitStatus();
            });
          }, shouldReconnectImmediately ? 500 : 3000);
        }
      });
    } catch (err) {
      this.isConnecting = false;
      this.state = 'disconnected';
      this.qrDataUrl = null;
      this.lastError = err instanceof Error ? err.message : 'Failed to initialize WhatsApp connection';
      this.emitStatus();
    }

    return this.getSnapshot();
  }

  private handleDeliveryAck(waMessageId: string): void {
    const row = db
      .prepare(`SELECT id, campaign_id, status FROM campaign_messages WHERE wa_message_id = ?`)
      .get(waMessageId) as { id: number; campaign_id: number; status: string } | undefined;

    if (!row || row.status === 'delivered') return;

    db.prepare(`
      UPDATE campaign_messages
      SET status = 'delivered',
          processed_at = COALESCE(processed_at, datetime('now'))
      WHERE id = ?
    `).run(row.id);

    if (row.status === 'submitted') {
      const today = new Date().toISOString().slice(0, 10);
      incrementDailyStat(today, { successful: 1 });
    }

    const updatedCampaign = recalculateCampaignCounts(row.campaign_id);
    if (updatedCampaign) {
      broadcastEvent('campaign:update', updatedCampaign);
    }
  }

  public async disconnect(): Promise<WhatsAppStatusSnapshot> {
    this.manualDisconnect = true;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }

    this.state = 'disconnected';
    this.qrDataUrl = null;
    this.phoneNumber = null;
    this.displayName = null;
    this.lastError = null;
    this.emitStatus();
    return this.getSnapshot();
  }

  public async logout(): Promise<WhatsAppStatusSnapshot> {
    this.manualDisconnect = true;
    this.isConnecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        try {
          this.sock.end(undefined);
        } catch {
          // ignore
        }
      }
      this.sock = null;
    }

    this.clearSessionFiles();
    this.state = 'disconnected';
    this.qrDataUrl = null;
    this.phoneNumber = null;
    this.displayName = null;
    this.lastError = null;
    this.emitStatus();
    return this.getSnapshot();
  }

  private clearSessionFiles(): void {
    try {
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    } catch {
      // ignore
    }
  }

  public async verifyCloudApi(phoneId: string, token: string): Promise<{ ok: boolean; displayPhone?: string; verifiedName?: string; error?: string }> {
    try {
      const resp = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json()) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string };
      };
      if (!resp.ok) {
        return { ok: false, error: json.error?.message || `HTTP ${resp.status}` };
      }
      return {
        ok: true,
        displayPhone: json.display_phone_number,
        verifiedName: json.verified_name,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
  }

  public isReadyToSend(): boolean {
    const snap = this.getSnapshot();
    return snap.state === 'connected';
  }

  public async sendMessage(phoneE164: string, payload: SendPayload): Promise<SendResult> {
    const settings = getAllSettings();
    if (settings.connection_mode === 'cloud_api') {
      return this.sendViaCloudApi(phoneE164, payload, settings.cloud_api_phone_id, settings.cloud_api_token);
    }

    if (!this.sock || this.state !== 'connected') {
      throw new Error('WhatsApp is disconnected. Connect via QR code before sending.');
    }

    const digits = phoneE164.replace(/\D/g, '');
    if (!digits) {
      throw new Error('Invalid recipient phone number');
    }

    // Verify number is registered on WhatsApp
    const checks = await this.sock.onWhatsApp(digits);
    const firstCheck = checks?.[0];
    if (!firstCheck || !firstCheck.exists) {
      throw new Error('Number is not registered on WhatsApp');
    }

    const jid = firstCheck.jid || `${digits}@s.whatsapp.net`;
    const text = payload.text || '';

    let sentMsg;
    if (payload.attachmentPath && fs.existsSync(payload.attachmentPath)) {
      const fileBuffer = fs.readFileSync(payload.attachmentPath);
      if (payload.attachmentType === 'image') {
        sentMsg = await this.sock.sendMessage(jid, {
          image: fileBuffer,
          mimetype: payload.attachmentMime || 'image/jpeg',
          caption: text || undefined,
        });
      } else if (payload.attachmentType === 'pdf') {
        sentMsg = await this.sock.sendMessage(jid, {
          document: fileBuffer,
          mimetype: payload.attachmentMime || 'application/pdf',
          fileName: payload.attachmentName || 'document.pdf',
          caption: text || undefined,
        });
      } else if (payload.attachmentType === 'video') {
        sentMsg = await this.sock.sendMessage(jid, {
          video: fileBuffer,
          mimetype: payload.attachmentMime || 'video/mp4',
          caption: text || undefined,
        });
      } else {
        sentMsg = await this.sock.sendMessage(jid, { text });
      }
    } else {
      sentMsg = await this.sock.sendMessage(jid, { text });
    }

    const waMessageId = sentMsg?.key?.id;
    if (!waMessageId) {
      throw new Error('WhatsApp server did not return a message confirmation ID');
    }

    const initialStatus: 'submitted' | 'delivered' =
      typeof sentMsg?.status === 'number' && sentMsg.status >= 3 ? 'delivered' : 'submitted';

    return { waMessageId, status: initialStatus };
  }

  private async sendViaCloudApi(
    phoneE164: string,
    payload: SendPayload,
    phoneId: string,
    token: string
  ): Promise<SendResult> {
    if (!phoneId || !token) {
      throw new Error('Official WhatsApp Cloud API credentials are missing.');
    }

    const to = phoneE164.replace(/\D/g, '');
    const text = payload.text || '';
    let body: Record<string, unknown>;

    if (payload.attachmentPath && fs.existsSync(payload.attachmentPath)) {
      const form = new FormData();
      const buffer = fs.readFileSync(payload.attachmentPath);
      const mime = payload.attachmentMime || 'application/octet-stream';
      const blob = new Blob([buffer], { type: mime });
      form.append('messaging_product', 'whatsapp');
      form.append('file', blob, payload.attachmentName || 'attachment');

      const uploadResp = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const uploadJson = (await uploadResp.json()) as { id?: string; error?: { message?: string } };
      if (!uploadResp.ok || !uploadJson.id) {
        throw new Error(uploadJson.error?.message || 'Cloud API media upload failed');
      }

      if (payload.attachmentType === 'image') {
        body = {
          messaging_product: 'whatsapp',
          to,
          type: 'image',
          image: { id: uploadJson.id, ...(text ? { caption: text } : {}) },
        };
      } else if (payload.attachmentType === 'pdf') {
        body = {
          messaging_product: 'whatsapp',
          to,
          type: 'document',
          document: {
            id: uploadJson.id,
            filename: payload.attachmentName || 'document.pdf',
            ...(text ? { caption: text } : {}),
          },
        };
      } else {
        body = {
          messaging_product: 'whatsapp',
          to,
          type: 'video',
          video: { id: uploadJson.id, ...(text ? { caption: text } : {}) },
        };
      }
    } else {
      body = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      };
    }

    const resp = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await resp.json()) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };

    if (!resp.ok || !json.messages?.[0]?.id) {
      throw new Error(json.error?.message || `Cloud API rejected message (HTTP ${resp.status})`);
    }

    return {
      waMessageId: json.messages[0].id,
      status: 'submitted',
    };
  }
}

export const whatsappManager = new WhatsAppManager();
