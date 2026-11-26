import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Infinity as InfinityIcon,
  LogOut,
  MessageSquareText,
  QrCode,
  Users,
} from 'lucide-react';
import { api, apiUrl, testBackendHealth } from './api.ts';
import {
  clearLocalSession,
  loadLocalSession,
  saveLocalSession,
  verifySessionWithServer,
  type ActiveLicenseSession,
} from './auth/licenseService.ts';
import type {
  AnalyticsData,
  AppSettings,
  Campaign,
  CampaignMessage,
  ContactItem,
  CountryOption,
  DraftMessage,
  WhatsAppStatus,
} from './types.ts';
import { LoginScreen } from './components/LoginScreen.tsx';
import { WhatsAppLoginView } from './components/WhatsAppLoginView.tsx';
import { PhoneNumbersView } from './components/PhoneNumbersView.tsx';
import { ComposerSpeedView } from './components/ComposerSpeedView.tsx';
import { SendingDashboardView } from './components/SendingDashboardView.tsx';
import { AnalyticsView } from './components/AnalyticsView.tsx';

type NavSection = 'login' | 'numbers' | 'composer' | 'dashboard' | 'analytics';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof QrCode }> = [
  { id: 'login', label: 'WhatsApp Login', icon: QrCode },
  { id: 'numbers', label: 'Phone Numbers', icon: Users },
  { id: 'composer', label: 'Composer & Speed', icon: MessageSquareText },
  { id: 'dashboard', label: 'Sending Dashboard', icon: Activity },
  { id: 'analytics', label: 'Analytics & Backups', icon: BarChart3 },
];

const DEFAULT_WA_STATUS: WhatsAppStatus = {
  mode: 'qr',
  state: 'disconnected',
  qrDataUrl: null,
  phoneNumber: null,
  displayName: null,
  hasSavedSession: false,
  lastError: null,
  updatedAt: new Date().toISOString(),
};

const DEFAULT_DRAFT: DraftMessage = {
  id: 1,
  body_text: '',
  attachment_path: null,
  attachment_name: null,
  attachment_mime: null,
  attachment_size: null,
  attachment_type: null,
  attachmentUrl: null,
  updated_at: new Date().toISOString(),
};

const DEFAULT_SETTINGS: AppSettings = {
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

function formatTrialCountdown(expiresAtMs: number | null): string {
  if (!expiresAtMs) return '24h Trial';
  const diff = expiresAtMs - Date.now();
  if (diff <= 0) return 'Expired';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hrs}h ${mins}m left`;
}

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [licenseSession, setLicenseSession] = useState<ActiveLicenseSession | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const [activeNav, setActiveNav] = useState<NavSection>('login');
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>(DEFAULT_WA_STATUS);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [draft, setDraft] = useState<DraftMessage>(DEFAULT_DRAFT);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignMessages, setCampaignMessages] = useState<CampaignMessage[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendVersion, setBackendVersion] = useState(0);

  // Verify saved license session against Firebase on mount
  useEffect(() => {
    void (async () => {
      const saved = loadLocalSession();
      if (!saved) {
        setAuthChecking(false);
        return;
      }

      const check = await verifySessionWithServer(saved);
      if (!check.valid) {
        clearLocalSession();
        setLicenseSession(null);
        setAuthNotice(check.reason || 'Session expired. Please sign in again.');
      } else {
        const finalSession = check.updatedSession || saved;
        if (check.updatedSession) saveLocalSession(check.updatedSession);
        setLicenseSession(finalSession);
      }
      setAuthChecking(false);
    })();
  }, []);

  // Periodic 24-hour trial expiration check & live countdown refresh
  useEffect(() => {
    if (!licenseSession) return;

    const timer = setInterval(() => {
      setTick((t) => t + 1);
      if (
        licenseSession.licenseType === 'trial_key' &&
        licenseSession.expiresAtMs &&
        Date.now() >= licenseSession.expiresAtMs
      ) {
        clearLocalSession();
        setLicenseSession(null);
        setAuthNotice('Your 24-hour trial key has expired.');
      }
    }, 15000);

    const serverCheckTimer = setInterval(() => {
      void verifySessionWithServer(licenseSession).then((res) => {
        if (!res.valid) {
          clearLocalSession();
          setLicenseSession(null);
          setAuthNotice(res.reason || 'Your account session is no longer active.');
        }
      });
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(timer);
      clearInterval(serverCheckTimer);
    };
  }, [licenseSession]);

  const refreshContacts = useCallback(async () => {
    const res = await api.getContacts();
    setContacts(res.contacts);
  }, []);

  const refreshSettings = useCallback(async () => {
    const res = await api.getSettings();
    setSettings(res);
  }, []);

  const refreshCampaign = useCallback(
    async (filter = statusFilter) => {
      const res = await api.getCurrentCampaign(filter);
      setCampaign(res.campaign);
      setCampaignMessages(res.messages);
    },
    [statusFilter]
  );

  const refreshAnalytics = useCallback(async () => {
    const res = await api.getAnalytics();
    setAnalytics(res);
  }, []);

  useEffect(() => {
    if (!licenseSession) return;

    void (async () => {
      try {
        const health = await testBackendHealth();
        if (!health.ok) {
          setBackendReachable(false);
          return;
        }
        setBackendReachable(true);

        const [wa, countryList, contactData, draftData, settingsData, campData, analyticsData] =
          await Promise.all([
            api.getWhatsAppStatus(),
            api.getCountries(),
            api.getContacts(),
            api.getDraft(),
            api.getSettings(),
            api.getCurrentCampaign('all'),
            api.getAnalytics(),
          ]);

        setWaStatus(wa);
        setCountries(countryList);
        setContacts(contactData.contacts);
        setDraft(draftData);
        setSettings(settingsData);
        setCampaign(campData.campaign);
        setCampaignMessages(campData.messages);
        setAnalytics(analyticsData);
      } catch {
        setBackendReachable(false);
      } finally {
        setInitialLoaded(true);
      }
    })();
  }, [licenseSession, backendVersion]);

  // Subscribe to Server-Sent Events for real-time QR & campaign updates
  useEffect(() => {
    if (!licenseSession || !backendReachable) return;

    const source = new EventSource(apiUrl('/api/events'));

    source.addEventListener('whatsapp:status', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data) as WhatsAppStatus;
        setWaStatus(next);
      } catch {
        // ignore malformed event
      }
    });

    source.addEventListener('campaign:update', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data) as Campaign;
        setCampaign(next);
        void api.getCurrentCampaign(statusFilter).then((res) => {
          setCampaignMessages(res.messages);
        });
        if (next.status === 'completed' || next.status === 'stopped') {
          void refreshAnalytics();
          void refreshContacts();
        }
      } catch {
        // ignore
      }
    });

    return () => {
      source.close();
    };
  }, [licenseSession, backendReachable, backendVersion, statusFilter, refreshAnalytics, refreshContacts]);

  // Serverless-friendly polling fallback when QR pairing or campaign sending is active
  useEffect(() => {
    if (!licenseSession || !backendReachable) return;
    const needsWaPoll = waStatus.state === 'connecting' || waStatus.state === 'qr_ready';
    const needsCampaignPoll = campaign?.status === 'running';
    if (!needsWaPoll && !needsCampaignPoll) return;

    const timer = setInterval(() => {
      if (needsWaPoll) {
        void api.getWhatsAppStatus().then(setWaStatus).catch(() => {});
      }
      if (needsCampaignPoll) {
        void refreshCampaign(statusFilter).catch(() => {});
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [licenseSession, backendReachable, waStatus.state, campaign?.status, statusFilter, refreshCampaign]);

  const handleStatusFilterChange = (nextFilter: string) => {
    setStatusFilter(nextFilter);
    void refreshCampaign(nextFilter);
  };

  const handleDefaultCountryChange = async (code: string) => {
    const next = await api.saveSettings({ default_country_code: code });
    setSettings(next);
  };

  const handleLogout = () => {
    clearLocalSession();
    setLicenseSession(null);
    setAuthNotice(null);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F6F8F7] flex items-center justify-center p-6">
        <div className="text-sm text-[#475A51]">Verifying Firebase license session...</div>
      </div>
    );
  }

  if (!licenseSession) {
    return (
      <LoginScreen
        notice={authNotice}
        onAuthenticated={(session) => {
          setAuthNotice(null);
          setLicenseSession(session);
        }}
      />
    );
  }

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeNav)!;

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#0F1D17] flex flex-col lg:flex-row">
      {/* Left Desktop Sidebar */}
      <aside className="w-full lg:w-64 lg:min-h-screen shrink-0 border-b lg:border-b-0 lg:border-r border-[#E2E8E4] bg-white flex flex-col justify-between">
        <div>
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-[#E2E8E4]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0D8A4E] text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-bold tracking-tight text-[#0F1D17] whitespace-nowrap">
                Strenx WhatsApp Sender
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex lg:flex-col gap-1 overflow-x-auto p-3">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveNav(item.id);
                    if (item.id === 'analytics') void refreshAnalytics();
                    if (item.id === 'dashboard') void refreshCampaign(statusFilter);
                  }}
                  className={`flex items-center justify-between gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#E8F6EE] text-[#0B6B3A]'
                      : 'text-[#475A51] hover:bg-[#F6F8F7] hover:text-[#0F1D17]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${isActive ? 'text-[#0D8A4E]' : 'text-[#73857C]'}`} />
                    {item.label}
                  </span>
                  {item.id === 'numbers' && contacts.length > 0 && (
                    <span className="font-mono text-xs text-[#73857C] tabular-nums">
                      {contacts.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Real Connection Status & Account License Info */}
        <div className="hidden lg:block border-t border-[#E2E8E4] p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#73857C]">WhatsApp Status</span>
            <span
              className={`inline-flex items-center gap-1.5 font-medium ${
                waStatus.state === 'connected'
                  ? 'text-[#0D8A4E]'
                  : waStatus.state === 'qr_ready' || waStatus.state === 'connecting'
                  ? 'text-amber-700'
                  : 'text-[#475A51]'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  waStatus.state === 'connected'
                    ? 'bg-[#16A34A]'
                    : waStatus.state === 'qr_ready' || waStatus.state === 'connecting'
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
                }`}
              />
              {waStatus.state === 'connected'
                ? 'Connected'
                : waStatus.state === 'qr_ready'
                ? 'Scan QR'
                : waStatus.state === 'connecting'
                ? 'Connecting'
                : 'Disconnected'}
            </span>
          </div>

          {waStatus.phoneNumber && (
            <p className="font-mono text-xs text-[#0F1D17] truncate tabular-nums">
              {waStatus.phoneNumber}
            </p>
          )}

          <div className="border-t border-[#EEF2EF] pt-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-medium text-[#0F1D17] truncate">
                {licenseSession.username}
              </span>
              {licenseSession.licenseType === 'permanent' ? (
                <span className="inline-flex items-center gap-1 text-[#0D8A4E] font-medium whitespace-nowrap">
                  <InfinityIcon className="h-3.5 w-3.5" />
                  Permanent
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-mono text-amber-700 font-medium whitespace-nowrap tabular-nums">
                  <Clock className="h-3 w-3" />
                  {formatTrialCountdown(licenseSession.expiresAtMs)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#D4DDD8] bg-white px-3 py-1.5 text-xs font-medium text-[#475A51] hover:bg-[#F6F8F7] hover:text-[#0F1D17] cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 shrink-0 border-b border-[#E2E8E4] bg-white px-6 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-[#73857C] whitespace-nowrap">Strenx</span>
            <span className="text-[#CBD5E1]" aria-hidden="true">/</span>
            <h1 className="font-semibold text-[#0F1D17] truncate">{activeNavMeta.label}</h1>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {campaign && (campaign.status === 'running' || campaign.status === 'paused') && (
              <button
                type="button"
                onClick={() => setActiveNav('dashboard')}
                className="text-xs font-mono font-medium text-[#0D8A4E] hover:underline whitespace-nowrap shrink-0 cursor-pointer tabular-nums"
              >
                {campaign.status === 'running' ? 'Sending:' : 'Paused:'}{' '}
                {campaign.delivered_count + campaign.submitted_count + campaign.failed_count}/
                {campaign.total_count}
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveNav(activeNav === 'dashboard' ? 'composer' : 'dashboard')}
              className="rounded-lg bg-[#0D8A4E] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0A6E3E] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {activeNav === 'dashboard' ? 'Edit Message' : 'Open Sending Dashboard'}
            </button>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 p-6 lg:p-8 max-w-[1240px] w-full mx-auto">
          {!initialLoaded ? (
            <div className="space-y-4">
              <div className="h-10 w-64 rounded-lg bg-[#E2E8E4]/60 animate-pulse" />
              <div className="h-72 w-full rounded-xl bg-[#E2E8E4]/50 animate-pulse" />
            </div>
          ) : (
            <>
              {activeNav === 'login' && (
                <WhatsAppLoginView
                  status={waStatus}
                  settings={settings}
                  backendReachable={backendReachable}
                  onStatusChange={setWaStatus}
                  onSettingsRefresh={refreshSettings}
                  onBackendReconnected={() => setBackendVersion((v) => v + 1)}
                />
              )}

              {activeNav === 'numbers' && (
                <PhoneNumbersView
                  contacts={contacts}
                  countries={countries}
                  defaultCountry={settings.default_country_code || 'US'}
                  onContactsChanged={refreshContacts}
                  onDefaultCountryChanged={handleDefaultCountryChange}
                />
              )}

              {activeNav === 'composer' && (
                <ComposerSpeedView
                  draft={draft}
                  settings={settings}
                  onDraftChange={setDraft}
                  onSettingsChange={setSettings}
                />
              )}

              {activeNav === 'dashboard' && (
                <SendingDashboardView
                  campaign={campaign}
                  messages={campaignMessages}
                  waStatus={waStatus}
                  contactsCount={contacts.length}
                  draft={draft}
                  settings={settings}
                  statusFilter={statusFilter}
                  onStatusFilterChange={handleStatusFilterChange}
                  onCampaignRefresh={() => {
                    void refreshCampaign(statusFilter);
                    void refreshAnalytics();
                  }}
                />
              )}

              {activeNav === 'analytics' && (
                <AnalyticsView
                  analytics={analytics}
                  settings={settings}
                  onRefresh={refreshAnalytics}
                  onSettingsChange={setSettings}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
