import type {
  AnalyticsData,
  AppSettings,
  BackupItem,
  Campaign,
  CampaignMessage,
  ContactItem,
  CountryOption,
  CsvPreviewResponse,
  DraftMessage,
  WhatsAppStatus,
} from './types.ts';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${resp.status})`);
  }
  return data as T;
}

export const api = {
  getWhatsAppStatus: () => requestJson<WhatsAppStatus>('/api/whatsapp/status'),
  connectQR: () => requestJson<WhatsAppStatus>('/api/whatsapp/connect', { method: 'POST' }),
  disconnectWA: () => requestJson<WhatsAppStatus>('/api/whatsapp/disconnect', { method: 'POST' }),
  logoutWA: () => requestJson<WhatsAppStatus>('/api/whatsapp/logout', { method: 'POST' }),
  configureCloudApi: (payload: { mode: 'qr' | 'cloud_api'; phoneId?: string; accessToken?: string }) =>
    requestJson<{ ok: boolean; verifiedName?: string; displayPhone?: string; status: WhatsAppStatus }>(
      '/api/whatsapp/cloud-api',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    ),

  getCountries: () => requestJson<CountryOption[]>('/api/countries'),

  getContacts: () => requestJson<{ contacts: ContactItem[]; totalCount: number }>('/api/contacts'),
  addManualContacts: (input: string, countryCode: string) =>
    requestJson<{
      inserted: number;
      validCount: number;
      invalidCount: number;
      duplicateCount: number;
      invalidEntries: Array<{ raw: string; error: string | null }>;
    }>('/api/contacts/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, countryCode }),
    }),

  bulkPasteContacts: (text: string, countryCode: string) =>
    requestJson<{
      totalLines: number;
      inserted: number;
      validCount: number;
      invalidCount: number;
      duplicateCount: number;
      invalidEntries: Array<{ raw: string; error: string | null }>;
    }>('/api/contacts/bulk-paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, countryCode }),
    }),

  previewCsvContacts: async (file: File, countryCode: string, column?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('countryCode', countryCode);
    if (column) form.append('column', column);
    return requestJson<CsvPreviewResponse>('/api/contacts/csv/preview', {
      method: 'POST',
      body: form,
    });
  },

  importCsvContacts: async (file: File, countryCode: string, column?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('countryCode', countryCode);
    if (column) form.append('column', column);
    return requestJson<{
      totalRows: number;
      inserted: number;
      validCount: number;
      invalidCount: number;
      duplicateCount: number;
    }>('/api/contacts/csv/import', {
      method: 'POST',
      body: form,
    });
  },

  deleteContact: (id: number) => requestJson<{ ok: boolean }>(`/api/contacts/${id}`, { method: 'DELETE' }),
  clearAllContacts: () => requestJson<{ ok: boolean }>('/api/contacts', { method: 'DELETE' }),

  getDraft: () => requestJson<DraftMessage>('/api/draft'),
  saveDraftText: (bodyText: string) =>
    requestJson<DraftMessage>('/api/draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyText }),
    }),
  uploadAttachment: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestJson<DraftMessage>('/api/draft/attachment', {
      method: 'POST',
      body: form,
    });
  },
  removeAttachment: () => requestJson<DraftMessage>('/api/draft/attachment', { method: 'DELETE' }),

  getSettings: () => requestJson<AppSettings>('/api/settings'),
  saveSettings: (updates: Partial<AppSettings>) =>
    requestJson<AppSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }),

  getCurrentCampaign: (status = 'all') =>
    requestJson<{ campaign: Campaign | null; messages: CampaignMessage[] }>(
      `/api/campaign/current?status=${encodeURIComponent(status)}`
    ),
  startCampaign: (name?: string, skipAlreadyMessaged?: boolean) =>
    requestJson<{ campaign: Campaign; skippedDuplicates: number }>('/api/campaign/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, skipAlreadyMessaged }),
    }),
  pauseCampaign: () => requestJson<{ campaign: Campaign | null }>('/api/campaign/pause', { method: 'POST' }),
  resumeCampaign: () => requestJson<{ campaign: Campaign }>('/api/campaign/resume', { method: 'POST' }),
  stopCampaign: () => requestJson<{ campaign: Campaign | null }>('/api/campaign/stop', { method: 'POST' }),

  getAnalytics: () => requestJson<AnalyticsData>('/api/analytics'),
  createBackup: () => requestJson<BackupItem>('/api/backups/create', { method: 'POST' }),
};
