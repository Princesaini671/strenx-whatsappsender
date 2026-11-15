import {
  createCampaignWithRecipients,
  createLocalBackup,
  getActiveCampaignByStatus,
  getActiveOrLatestCampaign as getStoreActiveOrLatestCampaign,
  getActiveRunningOrPausedCampaign,
  getAllSettings,
  getCampaignById,
  getDraft,
  getNextQueuedMessage,
  getPreviouslyMessagedSet,
  getValidContactPhones,
  incrementDailyStat,
  listCampaignMessages,
  recalculateCampaignCounts,
  stampNow,
  stopQueuedMessagesForCampaign,
  updateCampaignFields,
  updateCampaignMessageFields,
  type CampaignMessageRow,
  type CampaignRow,
} from './store.ts';
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
    return getStoreActiveOrLatestCampaign();
  }

  public getCampaignMessages(campaignId: number, limit = 200, statusFilter = 'all'): CampaignMessageRow[] {
    return listCampaignMessages(campaignId, limit, statusFilter);
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
    const existingActive = getActiveRunningOrPausedCampaign();

    if (existingActive) {
      throw new Error(
        `Campaign "${existingActive.name}" is currently ${existingActive.status}. Stop or finish it before starting a new campaign.`
      );
    }

    if (!whatsappManager.isReadyToSend()) {
      throw new Error('WhatsApp is not connected. Please scan the QR code or configure Cloud API first.');
    }

    const draft = getDraft();
    const hasText = Boolean(draft.body_text && draft.body_text.trim().length > 0);
    const hasAttachment = Boolean(draft.attachment_path);

    if (!hasText && !hasAttachment) {
      throw new Error('Cannot start campaign with an empty message and no attachment.');
    }

    let recipients = getValidContactPhones();
    if (recipients.length === 0) {
      throw new Error('No valid phone numbers available. Add or import numbers first.');
    }

    const settings = getAllSettings();
    const skipAlready =
      options?.skipAlreadyMessaged !== undefined
        ? options.skipAlreadyMessaged
        : settings.skip_already_messaged === '1';

    let skippedDuplicates = 0;

    if (skipAlready) {
      const sentSet = getPreviouslyMessagedSet();
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

    const campaign = createCampaignWithRecipients(
      {
        name: campaignName,
        message_text: draft.body_text || '',
        attachment_path: draft.attachment_path,
        attachment_name: draft.attachment_name,
        attachment_mime: draft.attachment_mime,
        attachment_type: draft.attachment_type,
        interval_seconds: intervalSeconds,
        batch_size: batchSize,
        batch_pause_seconds: batchPauseSeconds,
        last_activity: `Campaign started (${recipients.length} queued${
          skippedDuplicates > 0 ? `, ${skippedDuplicates} previously messaged skipped` : ''
        })`,
      },
      recipients
    );

    this.emitCampaign(campaign);
    this.activeCampaignId = campaign.id;
    this.startLoop(campaign.id);

    return { campaign, skippedDuplicates };
  }

  public async pauseCampaign(reason = 'Paused by user'): Promise<CampaignRow | null> {
    const active = getActiveCampaignByStatus('running');
    if (!active) {
      return this.getActiveOrLatestCampaign();
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    updateCampaignFields(active.id, {
      status: 'paused',
      processing_count: 0,
      current_phone: null,
      last_activity: reason,
    });

    const updated = recalculateCampaignCounts(active.id)!;
    this.emitCampaign(updated);
    return updated;
  }

  public async resumeCampaign(): Promise<CampaignRow> {
    const paused = getActiveCampaignByStatus('paused');
    if (!paused) {
      throw new Error('No paused campaign found to resume.');
    }

    if (!whatsappManager.isReadyToSend()) {
      throw new Error('WhatsApp is disconnected. Reconnect before resuming the campaign.');
    }

    updateCampaignFields(paused.id, {
      status: 'running',
      last_activity: 'Resumed campaign sending',
    });

    const updated = recalculateCampaignCounts(paused.id)!;
    this.emitCampaign(updated);

    this.activeCampaignId = paused.id;
    if (!this.loopRunning) {
      this.startLoop(paused.id);
    }

    return updated;
  }

  public async stopCampaign(): Promise<CampaignRow | null> {
    const target = getActiveRunningOrPausedCampaign();
    if (!target) {
      return this.getActiveOrLatestCampaign();
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    stopQueuedMessagesForCampaign(target.id);
    updateCampaignFields(target.id, {
      status: 'stopped',
      processing_count: 0,
      current_phone: null,
      completed_at: stampNow(),
      last_activity: 'Campaign stopped by user',
    });

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
          const campaign = getCampaignById(campaignId);
          if (!campaign || campaign.status !== 'running') {
            break;
          }

          const nextMsg = getNextQueuedMessage(campaignId);
          if (!nextMsg) {
            updateCampaignFields(campaignId, {
              status: 'completed',
              processing_count: 0,
              current_phone: null,
              completed_at: stampNow(),
              last_activity: 'Campaign completed all queued numbers',
            });
            const finalCampaign = recalculateCampaignCounts(campaignId);
            this.emitCampaign(finalCampaign);
            await createLocalBackup('auto').catch(() => {});
            break;
          }

          if (!whatsappManager.isReadyToSend()) {
            updateCampaignFields(campaignId, {
              status: 'paused',
              processing_count: 0,
              current_phone: null,
              last_activity: 'Paused automatically: WhatsApp disconnected',
            });
            const paused = recalculateCampaignCounts(campaignId);
            this.emitCampaign(paused);
            break;
          }

          updateCampaignFields(campaignId, {
            processing_count: 1,
            current_phone: nextMsg.phone_e164,
            last_activity: `Sending message to ${nextMsg.phone_e164}...`,
          });

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

            updateCampaignMessageFields(nextMsg.id, {
              status: result.status,
              wa_message_id: result.waMessageId,
              attempts: nextMsg.attempts + 1,
              error_message: null,
              processed_at: stampNow(),
            });

            incrementDailyStat(today, {
              attempted: 1,
              successful: result.status === 'delivered' ? 1 : 0,
            });

            updateCampaignFields(campaignId, {
              processing_count: 0,
              last_activity:
                result.status === 'delivered'
                  ? `Delivered to ${nextMsg.phone_e164}`
                  : `Submitted to ${nextMsg.phone_e164} (awaiting delivery receipt)`,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to send message';
            updateCampaignMessageFields(nextMsg.id, {
              status: 'failed',
              attempts: nextMsg.attempts + 1,
              error_message: errorMsg,
              processed_at: stampNow(),
            });

            incrementDailyStat(today, { attempted: 1, failed: 1 });

            updateCampaignFields(campaignId, {
              processing_count: 0,
              last_activity: `Failed for ${nextMsg.phone_e164}: ${errorMsg}`,
            });
          }

          processedInCurrentRun++;
          const updated = recalculateCampaignCounts(campaignId);
          this.emitCampaign(updated);

          const moreRemaining = (updated?.remaining_count ?? 0) > 0;
          if (!moreRemaining) {
            continue;
          }

          const isBatchBoundary =
            campaign.batch_size > 0 &&
            campaign.batch_pause_seconds > 0 &&
            processedInCurrentRun % campaign.batch_size === 0;

          if (isBatchBoundary) {
            updateCampaignFields(campaignId, {
              current_phone: null,
              last_activity: `Batch pause: waiting ${campaign.batch_pause_seconds}s after ${campaign.batch_size} messages`,
            });
            this.emitCampaign(recalculateCampaignCounts(campaignId));
            const continued = await this.interruptibleWait(campaign.batch_pause_seconds, controller.signal);
            if (!continued) break;
          } else {
            updateCampaignFields(campaignId, {
              current_phone: null,
              last_activity: `Waiting ${campaign.interval_seconds}s interval before next message`,
            });
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
