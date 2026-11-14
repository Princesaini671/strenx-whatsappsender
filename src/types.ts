export type ConnectionState = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface WhatsAppStatus {
  mode: 'qr' | 'cloud_api';
  state: ConnectionState;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  hasSavedSession: boolean;
  lastError: string | null;
  updatedAt: string;
}

export interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}

export interface ContactItem {
  id: number;
  raw_input: string;
  phone_e164: string;
  country_code: string | null;
  source: 'manual' | 'paste' | 'csv';
  is_valid: number;
  validation_error: string | null;
  created_at: string;
  previouslyMessaged?: boolean;
}

export interface BatchParseEntry {
  raw: string;
  e164: string | null;
  countryCode: string | null;
  isValid: boolean;
  isDuplicate?: boolean;
  error: string | null;
}

export interface CsvPreviewResponse {
  hasHeaders: boolean;
  headers: string[];
  selectedColumn: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  previewRows: BatchParseEntry[];
}

export interface DraftMessage {
  id: number;
  body_text: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_type: 'image' | 'pdf' | 'video' | null;
  attachmentUrl: string | null;
  updated_at: string;
}

export interface AppSettings {
  interval_seconds: string;
  batch_size: string;
  batch_pause_seconds: string;
  default_country_code: string;
  skip_already_messaged: string;
  connection_mode: string;
  cloud_api_phone_id: string;
  cloud_api_token: string;
  auto_backup_enabled: string;
  last_backup_at: string;
}

export interface Campaign {
  id: number;
  name: string;
  message_text: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_type: string | null;
  interval_seconds: number;
  batch_size: number;
  batch_pause_seconds: number;
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'completed';
  total_count: number;
  submitted_count: number;
  delivered_count: number;
  failed_count: number;
  remaining_count: number;
  processing_count: number;
  current_phone: string | null;
  last_activity: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CampaignMessage {
  id: number;
  campaign_id: number;
  phone_e164: string;
  status: 'queued' | 'submitted' | 'delivered' | 'failed' | 'stopped';
  wa_message_id: string | null;
  error_message: string | null;
  attempts: number;
  processed_at: string | null;
  created_at: string;
}

export interface DailyStat {
  date: string;
  total_attempted: number;
  successful: number;
  failed: number;
}

export interface BackupItem {
  id: number;
  filename: string;
  file_path: string;
  size_bytes: number;
  trigger_type: 'auto' | 'manual';
  created_at: string;
}

export interface AnalyticsData {
  summary: {
    totalMessages: number;
    successfulMessages: number;
    submittedMessages: number;
    failedMessages: number;
    remainingMessages: number;
    successPercentage: number;
    failurePercentage: number;
  };
  campaigns: Campaign[];
  dailyStats: DailyStat[];
  backups: BackupItem[];
  dataDir: string;
}
