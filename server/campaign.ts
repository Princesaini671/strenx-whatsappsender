import {
  db,
  getAllSettings,
  incrementDailyStat,
  recalculateCampaignCounts,
  createLocalBackup,
  type CampaignMessageRow,
  type CampaignRow,
  type DraftMessageRow,
} from './db.ts';
import { broadcastEvent } from './events.ts';
import { whatsappManager } from './whatsapp.ts';

class CampaignRunner {
  private activeCampaignId: number | null = null;
  private abortController: AbortController | null = null;
  private loopRunning = false;

  constructor() {
    whatsappManager.setOnUnexpectedDisconnect((reason) => {
      if (this.activeCampaignId !== null && this.loopRunning) {
        this.pauseCampaign(`Paused: ${reason}`).catch(() => {});
      }
    });
  }

  public getActiveOrLatestCampaign(): CampaignRow | null {
    const active = db
      .prepare(`SELECT * FROM campaigns WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1`)
      .get() as CampaignRow | undefined;
    if (active) return active;

    const latest = db
      .prepare(`SELECT * FROM campaigns ORDER BY id DESC LIMIT 1`)
      .get() as CampaignRow | undefined;
    return latest ?? null;
  }

  public getCampaignMessages(campaignId: number, limit = 200, statusFilter?: string): CampaignMessageRow[] {
    if (statusFilter && statusFilter !== 'all') {
      return db
        .prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? AND status = ? ORDER BY id ASC LIMIT ?`)
        .all(campaignId, statusFilter, limit) as CampaignMessageRow[];
    }
    return db
      .prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY id ASC LIMIT ?`)
      .all(campaignId, limit) as CampaignMessageRow[];
  }

  private emitCampaign(campaign: CampaignRow | undefined): void {
    if (campaign) {
      broadcastEvent('campaign:update', campaign);
    }
  }

  public async startCampaign(options?: {
    name?: string;
    skipAlreadyMessaged?: boolean;
  }): Promise<{ campaign: CampaignRow; skippedDuplicates: number }> {
    const existingActive = db
      .prepare(`SELECT * FROM campaigns WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1`)
      .get() as CampaignRow | undefined;

    if (existingActive) {
      throw new Error(
        `Campaign "${existingActive.name}" is currently ${existingActive.status}. Stop or finish it before starting a new campaign.`
      );
    }

    if (!whatsappManager.isReadyToSend()) {
      throw new Error('WhatsApp is not connected. Please scan the QR code or configure Cloud API first.');
    }

    const draft = db.prepare(`SELECT * FROM draft_message WHERE id = 1`).get() as DraftMessageRow;
    const hasText = Boolean(draft.body_text && draft.body_text.trim().length > 0);
    const hasAttachment = Boolean(draft.attachment_path);

    if (!hasText && !hasAttachment) {
      throw new Error('Cannot start campaign with an empty message and no attachment.');
    }

    const validContacts = db
      .prepare(`SELECT phone_e164 FROM contacts WHERE is_valid = 1 ORDER BY id ASC`)
      .all() as Array<{ phone_e164: string }>;

    if (validContacts.length === 0) {
      throw new Error('No valid phone numbers available. Add or import numbers first.');
    }

    const settings = getAllSettings();
    const skipAlready =
      options?.skipAlreadyMessaged !== undefined
        ? options.skipAlreadyMessaged
        : settings.skip_already_messaged === '1';

    let recipients = validContacts.map((c) => c.phone_e164);
    let skippedDuplicates = 0;

    if (skipAlready) {
      const previouslySentRows = db
        .prepare(`SELECT DISTINCT phone_e164 FROM campaign_messages WHERE status IN ('submitted', 'delivered')`)
        .all() as Array<{ phone_e164: string }>;
      const sentSet = new Set(previouslySentRows.map((r) => r.phone_e164));
      const filtered = recipients.filter((phone) => !sentSet.has(phone));
      skippedDuplicates = recipients.length - filtered.length;
      recipients = filtered;
    }

    if (recipients.length === 0) {
      throw new Error(
        'All valid numbers in your list were already messaged in previous campaigns. Uncheck duplicate protection if you intentionally want to re-send.'
      );
    }

    const intervalSeconds = Math.max(10, parseInt(settings.interval_seconds || '30', 10) || 30);
    const batchSize = Math.max(1, parseInt(settings.batch_size || '10', 10) || 10);
    const batchPauseSeconds = Math.max(0, parseInt(settings.batch_pause_seconds || '30', 10) || 30);

    const campaignName =
      options?.name?.trim() ||
      `Campaign ${new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`;

    const createTx = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO campaigns (
            name, message_text, attachment_path, attachment_name, attachment_mime, attachment_type,
            interval_seconds, batch_size, batch_pause_seconds,
            status, total_count, submitted_count, delivered_count, failed_count, remaining_count,
            processing_count, current_phone, last_activity, started_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, 0, 0, 0, ?, 0, NULL, ?, datetime('now'))
        `)
        .run(
          campaignName,
          draft.body_text || '',
          draft.attachment_path,
          draft.attachment_name,
          draft.attachment_mime,
          draft.attachment_type,
          intervalSeconds,
          batchSize,
          batchPauseSeconds,
          recipients.length,
          recipients.length,
          `Campaign started (${recipients.length} queued${skippedDuplicates > 0 ? `, ${skippedDuplicates} previously messaged skipped` : ''})`
        );

      const campaignId = Number(info.lastInsertRowid);
      const insertMsg = db.prepare(`
        INSERT OR IGNORE INTO campaign_messages (campaign_id, phone_e164, status)
        VALUES (?, ?, 'queued')
      `);

      for (const phone of recipients) {
        insertMsg.run(campaignId, phone);
      }

      return campaignId;
    });

    const campaignId = createTx();
    const campaign = recalculateCampaignCounts(campaignId)!;
    this.emitCampaign(campaign);

    this.activeCampaignId = campaignId;
    this.startLoop(campaignId);

    return { campaign, skippedDuplicates };
  }

  public async pauseCampaign(reason = 'Paused by user'): Promise<CampaignRow | null> {
    const active = db
      .prepare(`SELECT * FROM campaigns WHERE status = 'running' ORDER BY id DESC LIMIT 1`)
      .get() as CampaignRow | undefined;

    if (!active) {
      return this.getActiveOrLatestCampaign();
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    db.prepare(`
      UPDATE campaigns
      SET status = 'paused',
          processing_count = 0,
          current_phone = NULL,
          last_activity = ?
      WHERE id = ?
    `).run(reason, active.id);

    const updated = recalculateCampaignCounts(active.id)!;
    this.emitCampaign(updated);
    return updated;
  }

  public async resumeCampaign(): Promise<CampaignRow> {
    const paused = db
      .prepare(`SELECT * FROM campaigns WHERE status = 'paused' ORDER BY id DESC LIMIT 1`)
      .get() as CampaignRow | undefined;

    if (!paused) {
      throw new Error('No paused campaign found to resume.');
    }

    if (!whatsappManager.isReadyToSend()) {
      throw new Error('WhatsApp is disconnected. Reconnect before resuming the campaign.');
    }

    db.prepare(`
      UPDATE campaigns
      SET status = 'running',
          last_activity = 'Resumed campaign sending'
      WHERE id = ?
    `).run(paused.id);

    const updated = recalculateCampaignCounts(paused.id)!;
    this.emitCampaign(updated);

    this.activeCampaignId = paused.id;
    if (!this.loopRunning) {
      this.startLoop(paused.id);
    }

    return updated;
  }

  public async stopCampaign(): Promise<CampaignRow | null> {
    const target = db
      .prepare(`SELECT * FROM campaigns WHERE status IN ('running', 'paused') ORDER BY id DESC LIMIT 1`)
      .get() as CampaignRow | undefined;

    if (!target) {
      return this.getActiveOrLatestCampaign();
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE campaign_messages
        SET status = 'stopped',
            processed_at = datetime('now')
        WHERE campaign_id = ? AND status = 'queued'
      `).run(target.id);

      db.prepare(`
        UPDATE campaigns
        SET status = 'stopped',
            processing_count = 0,
            current_phone = NULL,
            completed_at = datetime('now'),
            last_activity = 'Campaign stopped by user'
        WHERE id = ?
      `).run(target.id);
    })();

    this.activeCampaignId = null;
    const updated = recalculateCampaignCounts(target.id)!;
    this.emitCampaign(updated);
    return updated;
  }

  private async interruptibleWait(seconds: number, signal: AbortSignal): Promise<boolean> {
    if (seconds <= 0) return !signal.aborted;
    return new Promise<boolean>((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, seconds * 1000);

      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private startLoop(campaignId: number): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    const controller = new AbortController();
    this.abortController = controller;

    void (async () => {
      let processedInCurrentRun = 0;

      try {
        while (!controller.signal.aborted) {
          const campaign = db
            .prepare(`SELECT * FROM campaigns WHERE id = ?`)
            .get(campaignId) as CampaignRow | undefined;

          if (!campaign || campaign.status !== 'running') {
            break;
          }

          const nextMsg = db
            .prepare(`SELECT * FROM campaign_messages WHERE campaign_id = ? AND status = 'queued' ORDER BY id ASC LIMIT 1`)
            .get(campaignId) as CampaignMessageRow | undefined;

          if (!nextMsg) {
            db.prepare(`
              UPDATE campaigns
              SET status = 'completed',
                  processing_count = 0,
                  current_phone = NULL,
                  completed_at = datetime('now'),
                  last_activity = 'Campaign completed all queued numbers'
              WHERE id = ?
            `).run(campaignId);
            const finalCampaign = recalculateCampaignCounts(campaignId);
            this.emitCampaign(finalCampaign);
            await createLocalBackup('auto').catch(() => {});
            break;
          }

          if (!whatsappManager.isReadyToSend()) {
            db.prepare(`
              UPDATE campaigns
              SET status = 'paused',
                  processing_count = 0,
                  current_phone = NULL,
                  last_activity = 'Paused automatically: WhatsApp disconnected'
              WHERE id = ?
            `).run(campaignId);
            const paused = recalculateCampaignCounts(campaignId);
            this.emitCampaign(paused);
            break;
          }

          // Mark processing = 1
          db.prepare(`
            UPDATE campaigns
            SET processing_count = 1,
                current_phone = ?,
                last_activity = ?
            WHERE id = ?
          `).run(nextMsg.phone_e164, `Sending message to ${nextMsg.phone_e164}...`, campaignId);

          this.emitCampaign(recalculateCampaignCounts(campaignId));

          const today = new Date().toISOString().slice(0, 10);

          try {
            const result = await whatsappManager.sendMessage(nextMsg.phone_e164, {
              text: campaign.message_text,
              attachmentPath: campaign.attachment_path,
              attachmentName: campaign.attachment_name,
              attachmentMime: campaign.attachment_mime,
              attachmentType: campaign.attachment_type as 'image' | 'pdf' | 'video' | null,
            });

            db.prepare(`
              UPDATE campaign_messages
              SET status = ?,
                  wa_message_id = ?,
                  attempts = attempts + 1,
                  error_message = NULL,
                  processed_at = datetime('now')
              WHERE id = ?
            `).run(result.status, result.waMessageId, nextMsg.id);

            incrementDailyStat(today, {
              attempted: 1,
              successful: result.status === 'delivered' ? 1 : 0,
            });

            db.prepare(`
              UPDATE campaigns
              SET processing_count = 0,
                  last_activity = ?
              WHERE id = ?
            `).run(
              result.status === 'delivered'
                ? `Delivered to ${nextMsg.phone_e164}`
                : `Submitted to ${nextMsg.phone_e164} (awaiting delivery receipt)`,
              campaignId
            );
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to send message';
            db.prepare(`
              UPDATE campaign_messages
              SET status = 'failed',
                  attempts = attempts + 1,
                  error_message = ?,
                  processed_at = datetime('now')
              WHERE id = ?
            `).run(errorMsg, nextMsg.id);

            incrementDailyStat(today, { attempted: 1, failed: 1 });

            db.prepare(`
              UPDATE campaigns
              SET processing_count = 0,
                  last_activity = ?
              WHERE id = ?
            `).run(`Failed for ${nextMsg.phone_e164}: ${errorMsg}`, campaignId);
          }

          processedInCurrentRun++;
          const updated = recalculateCampaignCounts(campaignId);
          this.emitCampaign(updated);

          // Check if more queued items remain before waiting
          const moreRemaining = (updated?.remaining_count ?? 0) > 0;
          if (!moreRemaining) {
            continue;
          }

          // Check batch pause rule
          const isBatchBoundary =
            campaign.batch_size > 0 &&
            campaign.batch_pause_seconds > 0 &&
            processedInCurrentRun % campaign.batch_size === 0;

          if (isBatchBoundary) {
            db.prepare(`
              UPDATE campaigns
              SET current_phone = NULL,
                  last_activity = ?
              WHERE id = ?
            `).run(
              `Batch pause: waiting ${campaign.batch_pause_seconds}s after ${campaign.batch_size} messages`,
              campaignId
            );
            this.emitCampaign(recalculateCampaignCounts(campaignId));
            const continued = await this.interruptibleWait(campaign.batch_pause_seconds, controller.signal);
            if (!continued) break;
          } else {
            db.prepare(`
              UPDATE campaigns
              SET current_phone = NULL,
                  last_activity = ?
              WHERE id = ?
            `).run(
              `Waiting ${campaign.interval_seconds}s interval before next message`,
              campaignId
            );
            this.emitCampaign(recalculateCampaignCounts(campaignId));
            const continued = await this.interruptibleWait(campaign.interval_seconds, controller.signal);
            if (!continued) break;
          }
        }
      } finally {
        this.loopRunning = false;
        if (this.abortController === controller) {
          this.abortController = null;
        }
        this.activeCampaignId = null;
      }
    })();
  }
}

export const campaignRunner = new CampaignRunner();
