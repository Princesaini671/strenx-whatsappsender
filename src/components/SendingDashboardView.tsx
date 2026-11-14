import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  RotateCcw,
  Send,
  Square,
  XCircle,
} from 'lucide-react';
import { api } from '../api.ts';
import type { AppSettings, Campaign, CampaignMessage, DraftMessage, WhatsAppStatus } from '../types.ts';

interface SendingDashboardViewProps {
  campaign: Campaign | null;
  messages: CampaignMessage[];
  waStatus: WhatsAppStatus;
  contactsCount: number;
  draft: DraftMessage;
  settings: AppSettings;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  onCampaignRefresh: () => void;
}

export function SendingDashboardView({
  campaign,
  messages,
  waStatus,
  contactsCount,
  draft,
  settings,
  statusFilter,
  onStatusFilterChange,
  onCampaignRefresh,
}: SendingDashboardViewProps) {
  const [campaignName, setCampaignName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const isRunning = campaign?.status === 'running';
  const isPaused = campaign?.status === 'paused';
  const hasActiveCampaign = isRunning || isPaused;

  const total = campaign?.total_count ?? 0;
  const delivered = campaign?.delivered_count ?? 0;
  const submitted = campaign?.submitted_count ?? 0;
  const failed = campaign?.failed_count ?? 0;
  const remaining = campaign?.remaining_count ?? 0;
  const processing = campaign?.processing_count ?? 0;

  // Successful + submitted + failed = processed out of total
  const processed = delivered + submitted + failed;
  const processedPercent = total > 0 ? Math.round((processed / total) * 100) : 0;

  const deliveredPct = total > 0 ? (delivered / total) * 100 : 0;
  const submittedPct = total > 0 ? (submitted / total) * 100 : 0;
  const failedPct = total > 0 ? (failed / total) * 100 : 0;
  const remainingPct = Math.max(0, 100 - deliveredPct - submittedPct - failedPct);

  const handleStart = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await api.startCampaign(
        campaignName.trim() || undefined,
        settings.skip_already_messaged !== '0'
      );
      setCampaignName('');
      if (res.skippedDuplicates > 0) {
        setInfoMsg(`Started campaign (${res.skippedDuplicates} previously messaged numbers skipped).`);
      }
      onCampaignRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start campaign');
    } finally {
      setBusy(false);
    }
  };

  const handlePause = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.pauseCampaign();
      onCampaignRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to pause campaign');
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.resumeCampaign();
      onCampaignRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to resume campaign');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.stopCampaign();
      setConfirmStop(false);
      onCampaignRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to stop campaign');
    } finally {
      setBusy(false);
    }
  };

  const hasContent = Boolean(draft.body_text?.trim() || draft.attachment_path);
  const canStart =
    !hasActiveCampaign &&
    waStatus.state === 'connected' &&
    contactsCount > 0 &&
    hasContent;

  return (
    <div className="space-y-6">
      {/* Header & Campaign Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0F1D17]">Live Sending Dashboard</h2>
          <p className="text-sm text-[#475A51]">
            Control campaign execution, monitor live delivery confirmations, and track queue progress.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!hasActiveCampaign && (
            <>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Campaign name (optional)"
                className="w-48 rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 text-xs text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleStart}
                disabled={busy || !canStart}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-4 w-4" />
                Start Sending
              </button>
            </>
          )}

          {isRunning && (
            <button
              type="button"
              onClick={handlePause}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              onClick={handleResume}
              disabled={busy || waStatus.state !== 'connected'}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Resume
            </button>
          )}

          {hasActiveCampaign &&
            (!confirmStop ? (
              <button
                type="button"
                onClick={() => setConfirmStop(true)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5">
                <span className="text-xs font-medium text-red-800">Stop campaign?</span>
                <button
                  type="button"
                  onClick={handleStop}
                  className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 cursor-pointer"
                >
                  Confirm Stop
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmStop(false)}
                  className="text-xs text-[#475A51] hover:text-[#0F1D17] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ))}
        </div>
      </div>

      {/* Pre-flight readiness notices */}
      {!hasActiveCampaign && !canStart && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-950">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
          <span>Before starting a campaign:</span>
          {waStatus.state !== 'connected' && (
            <span className="font-medium">Connect WhatsApp in the Login tab</span>
          )}
          {contactsCount === 0 && (
            <span className="font-medium">· Add phone numbers in Phone Numbers</span>
          )}
          {!hasContent && (
            <span className="font-medium">· Write a message or attach media in Composer</span>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {infoMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {infoMsg}
        </div>
      )}

      {/* 5 Primary KPI Counters + Submitted Count */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-[#73857C]">Total Numbers</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#0F1D17] tabular-nums">
            {total}
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-[#0D8A4E] font-medium">Successfully Sent</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#0D8A4E] tabular-nums">
            {delivered}
          </p>
          <p className="mt-0.5 text-[11px] text-[#73857C]">Confirmed delivered</p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-teal-700 font-medium">Submitted</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-teal-700 tabular-nums">
            {submitted}
          </p>
          <p className="mt-0.5 text-[11px] text-[#73857C]">Awaiting delivery ACK</p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-red-600 font-medium">Failed</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-red-600 tabular-nums">
            {failed}
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-[#475A51]">Remaining</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#475A51] tabular-nums">
            {remaining}
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-[#475A51]">Currently Processing</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#0F1D17] tabular-nums">
            {processing}
          </p>
        </div>
      </div>

      {/* Large Horizontal Segmented Progress Bar */}
      <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#0F1D17]">
              {campaign ? campaign.name : 'Campaign Progress'}
            </h3>
            <p className="text-xs text-[#73857C]">
              {campaign
                ? `Status: ${campaign.status.toUpperCase()} · Interval: ${campaign.interval_seconds}s · Batch pause: ${campaign.batch_pause_seconds}s every ${campaign.batch_size} msgs`
                : 'No campaign has been launched yet'}
            </p>
          </div>

          <div className="font-mono text-base font-semibold text-[#0F1D17] tabular-nums">
            {processed} / {total} processed = {processedPercent}%
          </div>
        </div>

        {/* Multi-segment Horizontal Bar */}
        <div
          className="flex h-6 w-full overflow-hidden rounded-lg bg-[#E2E8E4]"
          role="progressbar"
          aria-valuenow={processedPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {deliveredPct > 0 && (
            <div
              style={{ width: `${deliveredPct}%` }}
              className="bg-[#16A34A] transition-all duration-300"
              title={`Delivered: ${delivered}`}
            />
          )}
          {submittedPct > 0 && (
            <div
              style={{ width: `${submittedPct}%` }}
              className="bg-[#6EE7B7] transition-all duration-300"
              title={`Submitted (awaiting delivery ACK): ${submitted}`}
            />
          )}
          {failedPct > 0 && (
            <div
              style={{ width: `${failedPct}%` }}
              className="bg-[#DC2626] transition-all duration-300"
              title={`Failed: ${failed}`}
            />
          )}
          {remainingPct > 0 && (
            <div
              style={{ width: `${remainingPct}%` }}
              className="bg-[#CBD5E1] transition-all duration-300"
              title={`Remaining: ${remaining}`}
            />
          )}
        </div>

        {/* Legend & Live Activity */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-5 text-[#475A51]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#16A34A]" />
              Delivered ({delivered})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#6EE7B7]" />
              Submitted ({submitted})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#DC2626]" />
              Failed ({failed})
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-[#CBD5E1]" />
              Remaining ({remaining})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[#0F1D17]">
            {campaign?.current_phone && (
              <span className="font-mono font-medium text-[#0D8A4E] tabular-nums">
                Active: {campaign.current_phone}
              </span>
            )}
            {campaign?.last_activity && (
              <span className="text-[#475A51]">
                Last activity: <strong className="font-medium text-[#0F1D17]">{campaign.last_activity}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Recipient Status Queue Table */}
      <div className="rounded-xl border border-[#E2E8E4] bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-[#0F1D17]">Recipient Delivery Log</h3>
            <p className="text-xs text-[#73857C]">
              Distinguishes queued, submitted, delivered, and failed confirmations
            </p>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg bg-[#EDF2EF] p-1 text-xs">
            {(['all', 'queued', 'submitted', 'delivered', 'failed'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onStatusFilterChange(st)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white text-[#0F1D17] shadow-xs'
                    : 'text-[#475A51] hover:text-[#0F1D17]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#73857C]">
            {campaign
              ? 'No messages match the selected status filter.'
              : 'Start a campaign to view live message delivery tracking.'}
          </div>
        ) : (
          <div className="max-h-[380px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#F6F8F7] text-xs text-[#475A51] border-b border-[#E2E8E4]">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Phone Number</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Confirmation / Details</th>
                  <th className="px-5 py-2.5 text-right font-medium">Processed At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2EF]">
                {messages.map((msg) => (
                  <tr key={msg.id} className="hover:bg-[#F8FAF9] h-10">
                    <td className="px-5 py-2 font-mono font-medium text-[#0F1D17] tabular-nums">
                      {msg.phone_e164}
                    </td>
                    <td className="px-5 py-2 text-xs font-medium">
                      {msg.status === 'delivered' && (
                        <span className="inline-flex items-center gap-1.5 text-[#0D8A4E]">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Delivered
                        </span>
                      )}
                      {msg.status === 'submitted' && (
                        <span className="inline-flex items-center gap-1.5 text-teal-700">
                          <Send className="h-3.5 w-3.5" />
                          Submitted
                        </span>
                      )}
                      {msg.status === 'failed' && (
                        <span className="inline-flex items-center gap-1.5 text-red-600">
                          <XCircle className="h-3.5 w-3.5" />
                          Failed
                        </span>
                      )}
                      {msg.status === 'queued' && (
                        <span className="inline-flex items-center gap-1.5 text-[#475A51]">
                          <Clock className="h-3.5 w-3.5" />
                          Queued
                        </span>
                      )}
                      {msg.status === 'stopped' && (
                        <span className="inline-flex items-center gap-1.5 text-[#73857C]">
                          <Square className="h-3 w-3" />
                          Stopped
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-xs text-[#475A51]">
                      {msg.error_message ? (
                        <span className="text-red-600">{msg.error_message}</span>
                      ) : msg.wa_message_id ? (
                        <span className="font-mono text-[#73857C]">ID: {msg.wa_message_id}</span>
                      ) : (
                        <span className="text-[#73857C]">Waiting in queue</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-xs text-[#73857C] tabular-nums">
                      {msg.processed_at
                        ? new Date(msg.processed_at + 'Z').toLocaleTimeString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
