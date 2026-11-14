import { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { api } from '../api.ts';
import type { AnalyticsData, AppSettings } from '../types.ts';

interface AnalyticsViewProps {
  analytics: AnalyticsData | null;
  settings: AppSettings;
  onRefresh: () => void;
  onSettingsChange: (next: AppSettings) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AnalyticsView({
  analytics,
  settings,
  onRefresh,
  onSettingsChange,
}: AnalyticsViewProps) {
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const summary = analytics?.summary ?? {
    totalMessages: 0,
    successfulMessages: 0,
    submittedMessages: 0,
    failedMessages: 0,
    remainingMessages: 0,
    successPercentage: 0,
    failurePercentage: 0,
  };

  const dailyStats = analytics?.dailyStats ?? [];
  const campaigns = analytics?.campaigns ?? [];
  const backups = analytics?.backups ?? [];

  const maxDailyVal = Math.max(
    1,
    ...dailyStats.map((d) => Math.max(d.successful + d.failed, d.total_attempted))
  );

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    setBackupNotice(null);
    try {
      const b = await api.createBackup();
      setBackupNotice(`Backup saved locally: ${b.filename}`);
      onRefresh();
    } catch (err) {
      setBackupNotice(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleToggleAutoBackup = async (enabled: boolean) => {
    const next = await api.saveSettings({ auto_backup_enabled: enabled ? '1' : '0' });
    onSettingsChange(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0F1D17]">Analytics & Local Backups</h2>
          <p className="text-sm text-[#475A51]">
            Campaign performance metrics, daily delivery statistics, and SQLite database backups.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-lg border border-[#D4DDD8] bg-white px-3.5 py-2 text-xs font-medium text-[#0F1D17] hover:bg-[#F6F8F7] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Stats
        </button>
      </div>

      {/* Summary Metric Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-[#73857C]">Total Messages</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#0F1D17] tabular-nums">
            {summary.totalMessages}
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs font-medium text-[#0D8A4E]">Successful</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#0D8A4E] tabular-nums">
            {summary.successfulMessages}
          </p>
          <p className="mt-0.5 text-[11px] text-[#73857C]">Confirmed delivered</p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs font-medium text-red-600">Failed</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-red-600 tabular-nums">
            {summary.failedMessages}
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs text-[#475A51]">Remaining</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#475A51] tabular-nums">
            {summary.remainingMessages}
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs font-medium text-[#0D8A4E]">Success Rate</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#0D8A4E] tabular-nums">
            {summary.successPercentage}%
          </p>
        </div>

        <div className="rounded-xl border border-[#E2E8E4] bg-white p-4">
          <p className="text-xs font-medium text-red-600">Failure Rate</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-red-600 tabular-nums">
            {summary.failurePercentage}%
          </p>
        </div>
      </div>

      {/* Charts Row: Daily Stats + Outcome Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#0F1D17]">Daily Messaging Statistics</h3>
              <p className="text-xs text-[#73857C]">
                Confirmed delivered vs failed messages by day
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#475A51]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#16A34A]" />
                Successful
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#DC2626]" />
                Failed
              </span>
            </div>
          </div>

          {dailyStats.length === 0 ? (
            <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-[#E2E8E4] text-xs text-[#73857C]">
              Daily chart will populate once campaigns process messages.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex h-56 min-w-[420px] items-end gap-3 border-b border-[#E2E8E4] pb-2 pt-6 px-2">
                {dailyStats.map((day) => {
                  const succHeight = Math.round((day.successful / maxDailyVal) * 140);
                  const failHeight = Math.round((day.failed / maxDailyVal) * 140);
                  return (
                    <div
                      key={day.date}
                      className="flex flex-1 flex-col items-center gap-2 min-w-[42px]"
                    >
                      <div className="flex items-end gap-1 h-[150px]">
                        <div
                          className="w-4 rounded-t bg-[#16A34A] transition-all"
                          style={{ height: `${Math.max(day.successful > 0 ? 4 : 0, succHeight)}px` }}
                          title={`${day.date}: ${day.successful} successful`}
                        />
                        <div
                          className="w-4 rounded-t bg-[#DC2626] transition-all"
                          style={{ height: `${Math.max(day.failed > 0 ? 4 : 0, failHeight)}px` }}
                          title={`${day.date}: ${day.failed} failed`}
                        />
                      </div>
                      <div className="text-center">
                        <p className="font-mono text-[10px] text-[#475A51] tabular-nums">
                          {day.date.slice(5)}
                        </p>
                        <p className="font-mono text-[10px] text-[#73857C] tabular-nums">
                          {day.successful}/{day.failed}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Success / Failure Distribution */}
        <div className="lg:col-span-4 rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-[#0F1D17]">Outcome Distribution</h3>
            <p className="text-xs text-[#73857C]">
              Based on finalized deliveries & failures
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-[#0D8A4E]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Success Percentage
                </span>
                <span className="font-mono font-semibold text-[#0F1D17] tabular-nums">
                  {summary.successPercentage}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded bg-[#EEF2EF]">
                <div
                  className="h-full bg-[#16A34A] transition-all"
                  style={{ width: `${summary.successPercentage}%` }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-red-600">
                  <XCircle className="h-3.5 w-3.5" />
                  Failure Percentage
                </span>
                <span className="font-mono font-semibold text-[#0F1D17] tabular-nums">
                  {summary.failurePercentage}%
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded bg-[#EEF2EF]">
                <div
                  className="h-full bg-[#DC2626] transition-all"
                  style={{ width: `${summary.failurePercentage}%` }}
                />
              </div>
            </div>

            <div className="border-t border-[#E2E8E4] pt-4 text-xs text-[#475A51] space-y-1.5">
              <div className="flex justify-between">
                <span>Submitted (Awaiting ACK)</span>
                <span className="font-mono font-medium text-teal-700 tabular-nums">
                  {summary.submittedMessages}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Queued / Remaining</span>
                <span className="font-mono font-medium text-[#0F1D17] tabular-nums">
                  {summary.remainingMessages}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign History Table */}
      <div className="rounded-xl border border-[#E2E8E4] bg-white overflow-hidden">
        <div className="border-b border-[#E2E8E4] px-6 py-4">
          <h3 className="text-sm font-semibold text-[#0F1D17]">Campaign History</h3>
        </div>

        {campaigns.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[#73857C]">
            No campaigns recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F6F8F7] text-xs text-[#475A51] border-b border-[#E2E8E4]">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Campaign</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Total</th>
                  <th className="px-5 py-2.5 text-right font-medium">Delivered</th>
                  <th className="px-5 py-2.5 text-right font-medium">Submitted</th>
                  <th className="px-5 py-2.5 text-right font-medium">Failed</th>
                  <th className="px-5 py-2.5 text-right font-medium">Speed</th>
                  <th className="px-5 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2EF]">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-[#F8FAF9] h-10">
                    <td className="px-5 py-2 font-medium text-[#0F1D17]">{c.name}</td>
                    <td className="px-5 py-2 text-xs capitalize">
                      <span
                        className={
                          c.status === 'completed'
                            ? 'text-[#0D8A4E] font-medium'
                            : c.status === 'running'
                            ? 'text-[#0D8A4E] font-semibold'
                            : c.status === 'stopped'
                            ? 'text-red-600 font-medium'
                            : 'text-[#475A51]'
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-right font-mono tabular-nums">{c.total_count}</td>
                    <td className="px-5 py-2 text-right font-mono text-[#0D8A4E] font-medium tabular-nums">
                      {c.delivered_count}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-teal-700 tabular-nums">
                      {c.submitted_count}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-red-600 tabular-nums">
                      {c.failed_count}
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-xs text-[#73857C] tabular-nums">
                      {c.interval_seconds}s / {c.batch_size}m
                    </td>
                    <td className="px-5 py-2 text-right font-mono text-xs text-[#73857C] tabular-nums">
                      {new Date(c.created_at + 'Z').toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Automatic Local SQLite Backup */}
      <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-4">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-[#0D8A4E]" />
            <div>
              <h3 className="text-sm font-semibold text-[#0F1D17]">
                SQLite Database & Automatic Local Backups
              </h3>
              <p className="text-xs text-[#73857C] font-mono">
                Data directory: {analytics?.dataDir || './data'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs text-[#475A51] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.auto_backup_enabled !== '0'}
                onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                className="h-4 w-4 rounded border-[#D4DDD8] accent-[#0D8A4E]"
              />
              Auto-backup enabled
            </label>

            <button
              type="button"
              onClick={handleCreateBackup}
              disabled={creatingBackup}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2 text-xs font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <HardDrive className="h-3.5 w-3.5" />
              {creatingBackup ? 'Creating Backup...' : 'Create Backup Now'}
            </button>
          </div>
        </div>

        {backupNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
            {backupNotice}
          </div>
        )}

        {backups.length === 0 ? (
          <p className="text-xs text-[#73857C]">No local SQLite backups created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F6F8F7] text-[#475A51] border-b border-[#E2E8E4]">
                <tr>
                  <th className="px-4 py-2 font-medium">Backup File</th>
                  <th className="px-4 py-2 font-medium">Trigger</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 text-right font-medium">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2EF]">
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-[#F8FAF9]">
                    <td className="px-4 py-2 font-mono text-[#0F1D17]">{b.filename}</td>
                    <td className="px-4 py-2 capitalize text-[#475A51]">{b.trigger_type}</td>
                    <td className="px-4 py-2 font-mono text-[#475A51] tabular-nums">
                      {formatBytes(b.size_bytes)}
                    </td>
                    <td className="px-4 py-2 font-mono text-[#73857C] tabular-nums">
                      {new Date(b.created_at + 'Z').toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <a
                        href={`/api/backups/${b.id}/download`}
                        className="inline-flex items-center gap-1 text-[#0D8A4E] font-medium hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download .db
                      </a>
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
