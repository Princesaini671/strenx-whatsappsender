import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
} from 'lucide-react';
import { api } from '../api.ts';
import type { AppSettings, WhatsAppStatus } from '../types.ts';

interface WhatsAppLoginViewProps {
  status: WhatsAppStatus;
  settings: AppSettings | null;
  onStatusChange: (next: WhatsAppStatus) => void;
  onSettingsRefresh: () => void;
}

export function WhatsAppLoginView({
  status,
  settings,
  onStatusChange,
  onSettingsRefresh,
}: WhatsAppLoginViewProps) {
  const [activeTab, setActiveTab] = useState<'qr' | 'cloud_api'>(
    status.mode === 'cloud_api' ? 'cloud_api' : 'qr'
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const [phoneId, setPhoneId] = useState(settings?.cloud_api_phone_id || '');
  const [accessToken, setAccessToken] = useState(settings?.cloud_api_token || '');

  const handleConnectQR = async () => {
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const next = await api.connectQR();
      onStatusChange(next);
      onSettingsRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start WhatsApp QR session');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const next = await api.disconnectWA();
      onStatusChange(next);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const next = await api.logoutWA();
      onStatusChange(next);
      setConfirmLogout(false);
      setSuccessMsg('Session logged out and local credentials cleared.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to logout');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCloudApi = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.configureCloudApi({
        mode: 'cloud_api',
        phoneId,
        accessToken,
      });
      onStatusChange(res.status);
      onSettingsRefresh();
      setSuccessMsg(
        `Verified Official Cloud API: ${res.verifiedName || 'WhatsApp Business'} (${res.displayPhone || phoneId})`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to verify Cloud API credentials');
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchToQRMode = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await api.configureCloudApi({ mode: 'qr' });
      onStatusChange(res.status);
      onSettingsRefresh();
      setActiveTab('qr');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to switch mode');
    } finally {
      setBusy(false);
    }
  };

  const isConnected = status.state === 'connected';
  const isConnecting = status.state === 'connecting';
  const isQrReady = status.state === 'qr_ready';

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0F1D17]">WhatsApp Account Connection</h2>
          <p className="text-sm text-[#475A51]">
            Link your WhatsApp account via QR code or connect an official Meta Cloud API sender.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-[#EDF2EF] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'qr'
                ? 'bg-white text-[#0F1D17] shadow-xs'
                : 'text-[#475A51] hover:text-[#0F1D17]'
            }`}
          >
            <QrCode className="h-3.5 w-3.5" />
            QR Code Login
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cloud_api')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              activeTab === 'cloud_api'
                ? 'bg-white text-[#0F1D17] shadow-xs'
                : 'text-[#475A51] hover:text-[#0F1D17]'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Official Cloud API
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0D8A4E]" />
          <span>{successMsg}</span>
        </div>
      )}

      {activeTab === 'qr' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
          {/* Left: QR Display Area */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-xl border border-[#E2E8E4] bg-white p-8 text-center">
            {status.mode === 'cloud_api' ? (
              <div className="space-y-4">
                <QrCode className="mx-auto h-12 w-12 text-[#73857C]" />
                <p className="text-sm font-medium text-[#0F1D17]">
                  Official Cloud API mode is currently active
                </p>
                <p className="text-xs text-[#475A51] max-w-xs mx-auto">
                  Switch back to QR Code mode if you want to link a standard WhatsApp device via QR scan.
                </p>
                <button
                  type="button"
                  onClick={handleSwitchToQRMode}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Switch to QR Mode
                </button>
              </div>
            ) : isConnected ? (
              <div className="space-y-4">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[#E8F6EE] text-[#0D8A4E]">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[#0F1D17]">WhatsApp Connected</p>
                  <p className="mt-1 font-mono text-sm text-[#0D8A4E] tabular-nums">
                    {status.phoneNumber || 'Linked Device'}
                  </p>
                  {status.displayName && (
                    <p className="mt-0.5 text-xs text-[#475A51]">{status.displayName}</p>
                  )}
                </div>
                <p className="text-xs text-[#73857C]">
                  Session keys are stored locally in your secure desktop data directory.
                </p>
              </div>
            ) : isQrReady && status.qrDataUrl ? (
              <div className="space-y-4">
                <div className="inline-block rounded-xl border border-[#E2E8E4] bg-white p-3">
                  <img
                    src={status.qrDataUrl}
                    alt="WhatsApp Link QR Code"
                    className="h-64 w-64 object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0F1D17]">Scan QR code with WhatsApp</p>
                  <p className="mt-1 text-xs text-[#475A51]">
                    Open WhatsApp on your phone · Linked Devices · Link a Device
                  </p>
                </div>
              </div>
            ) : isConnecting ? (
              <div className="space-y-3 py-10">
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#0D8A4E]" />
                <p className="text-sm font-medium text-[#0F1D17]">Connecting to WhatsApp...</p>
                <p className="text-xs text-[#475A51]">
                  {status.hasSavedSession
                    ? 'Restoring saved session credentials'
                    : 'Generating a fresh QR pairing code'}
                </p>
              </div>
            ) : (
              <div className="space-y-4 py-6">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[#F2F5F3] text-[#475A51]">
                  <QrCode className="h-10 w-10" />
                </div>
                <div>
                  <p className="text-base font-semibold text-[#0F1D17]">WhatsApp Disconnected</p>
                  <p className="mt-1 text-xs text-[#475A51] max-w-xs mx-auto">
                    {status.hasSavedSession
                      ? 'Saved session detected. Click Reconnect to restore your session without re-scanning.'
                      : 'Click Connect & Show QR to generate a WhatsApp pairing QR code.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleConnectQR}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  {status.hasSavedSession ? 'Reconnect Session' : 'Connect & Show QR'}
                </button>
              </div>
            )}
          </div>

          {/* Right: Session Status, Controls & Unofficial Disclosure */}
          <div className="lg:col-span-7 flex flex-col justify-between rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-[#E2E8E4] pb-4">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5 text-[#0D8A4E]" />
                  <div>
                    <p className="text-sm font-semibold text-[#0F1D17]">Session Status</p>
                    <p className="text-xs text-[#475A51]">
                      Multi-device local session persistence
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isConnected
                        ? 'bg-[#16A34A]'
                        : isQrReady || isConnecting
                        ? 'bg-amber-500'
                        : 'bg-slate-400'
                    }`}
                  />
                  <span
                    className={
                      isConnected
                        ? 'text-[#0D8A4E]'
                        : isQrReady || isConnecting
                        ? 'text-amber-700'
                        : 'text-[#475A51]'
                    }
                  >
                    {isConnected
                      ? 'Connected'
                      : isQrReady
                      ? 'Awaiting QR Scan'
                      : isConnecting
                      ? 'Connecting'
                      : 'Disconnected'}
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-xs text-[#73857C]">Linked Number</dt>
                  <dd className="mt-1 font-mono font-medium text-[#0F1D17] tabular-nums">
                    {status.phoneNumber || 'Not linked'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#73857C]">Device Profile</dt>
                  <dd className="mt-1 font-medium text-[#0F1D17]">
                    {status.displayName || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#73857C]">Saved Local Session</dt>
                  <dd className="mt-1 font-medium text-[#0F1D17]">
                    {status.hasSavedSession ? 'Encrypted Auth Keys Present' : 'None'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#73857C]">Last Status Update</dt>
                  <dd className="mt-1 font-mono text-xs text-[#475A51] tabular-nums">
                    {new Date(status.updatedAt).toLocaleTimeString()}
                  </dd>
                </div>
              </dl>

              {status.lastError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                  {status.lastError}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleConnectQR}
                  disabled={busy || isConnecting}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="h-4 w-4" />
                  {isConnected ? 'Refresh Connection' : isQrReady ? 'Regenerate QR' : 'Connect / Reconnect'}
                </button>

                {(isConnected || isConnecting || isQrReady) && (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#D4DDD8] bg-white px-4 py-2 text-sm font-medium text-[#0F1D17] hover:bg-[#F6F8F7] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Unplug className="h-4 w-4" />
                    Disconnect
                  </button>
                )}

                {!confirmLogout ? (
                  <button
                    type="button"
                    onClick={() => setConfirmLogout(true)}
                    disabled={busy || (!isConnected && !status.hasSavedSession)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5">
                    <span className="text-xs font-medium text-red-800">Unlink & clear session?</span>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={busy}
                      className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Confirm Logout
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLogout(false)}
                      className="rounded px-2 py-1 text-xs font-medium text-[#475A51] hover:text-[#0F1D17] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Required Disclosure */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-950 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                Unofficial Integration Notice & Compliance
              </div>
              <p className="leading-relaxed text-amber-900/90">
                QR-based WhatsApp Web automation uses an unofficial protocol and is not endorsed by WhatsApp LLC. High-volume unsolicited messaging can trigger account warnings or restrictions. Always obtain recipient consent, honor opt-outs, and use conservative sending intervals. For official business messaging, use the Official Cloud API tab.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleSaveCloudApi}
            className="lg:col-span-7 rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-5"
          >
            <div className="flex items-center gap-3 border-b border-[#E2E8E4] pb-4">
              <ShieldCheck className="h-5 w-5 text-[#0D8A4E]" />
              <div>
                <h3 className="text-sm font-semibold text-[#0F1D17]">
                  Official WhatsApp Business Cloud API
                </h3>
                <p className="text-xs text-[#475A51]">
                  Connect directly through Meta Graph API v21.0 using your approved business sender.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                  Phone Number ID
                </label>
                <input
                  type="text"
                  value={phoneId}
                  onChange={(e) => setPhoneId(e.target.value)}
                  placeholder="e.g. 104928374650192"
                  className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3.5 py-2.5 font-mono text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                  Permanent System User Access Token
                </label>
                <input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="EAA..."
                  className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3.5 py-2.5 font-mono text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify & Activate Cloud API
              </button>

              {status.mode === 'cloud_api' && (
                <button
                  type="button"
                  onClick={handleSwitchToQRMode}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#D4DDD8] bg-white px-4 py-2.5 text-sm font-medium text-[#0F1D17] hover:bg-[#F6F8F7] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Switch Back to QR Mode
                </button>
              )}
            </div>
          </form>

          <div className="lg:col-span-5 rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[#0F1D17]">How Official Cloud API Works</h3>
            <ul className="space-y-2.5 text-xs text-[#475A51] leading-relaxed">
              <li>1. Credentials are verified live against Meta Graph API and stored locally in SQLite.</li>
              <li>2. Attachments (JPG, PNG, PDF, MP4) are uploaded via Meta Media API before dispatch.</li>
              <li>
                3. Graph API confirms server submission (`submitted`). Full delivery receipts require a public Meta webhook endpoint.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
