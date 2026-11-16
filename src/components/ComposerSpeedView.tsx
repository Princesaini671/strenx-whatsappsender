import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clock,
  FileText,
  Film,
  Image as ImageIcon,
  Paperclip,
  Save,
  ShieldAlert,
  Smile,
  Trash2,
} from 'lucide-react';
import { api, apiUrl } from '../api.ts';
import type { AppSettings, DraftMessage } from '../types.ts';

interface ComposerSpeedViewProps {
  draft: DraftMessage;
  settings: AppSettings;
  onDraftChange: (next: DraftMessage) => void;
  onSettingsChange: (next: AppSettings) => void;
}

const INTERVAL_OPTIONS = [
  { value: '10', label: '10 seconds' },
  { value: '20', label: '20 seconds' },
  { value: '30', label: '30 seconds (Recommended default)' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '180', label: '3 minutes' },
  { value: '240', label: '4 minutes' },
  { value: '300', label: '5 minutes' },
];

const BATCH_SIZE_OPTIONS = [
  { value: '5', label: 'Every 5 messages' },
  { value: '10', label: 'Every 10 messages' },
  { value: '15', label: 'Every 15 messages' },
  { value: '20', label: 'Every 20 messages' },
  { value: '25', label: 'Every 25 messages' },
  { value: '50', label: 'Every 50 messages' },
];

const BATCH_PAUSE_OPTIONS = [
  { value: '0', label: 'No extra batch pause' },
  { value: '20', label: 'Pause 20 seconds' },
  { value: '30', label: 'Pause 30 seconds (Default)' },
  { value: '60', label: 'Pause 1 minute' },
  { value: '120', label: 'Pause 2 minutes' },
  { value: '300', label: 'Pause 5 minutes' },
];

const QUICK_EMOJIS = [
  '👋', '✅', '✨', '🎉', '📦', '📄', '📞', '💬', '🙏', '🔥', '⭐', '📍', '🕒', '👉', '💡', '💼',
];

function formatBytes(bytes: number | null): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ComposerSpeedView({
  draft,
  settings,
  onDraftChange,
  onSettingsChange,
}: ComposerSpeedViewProps) {
  const [bodyText, setBodyText] = useState(draft.body_text || '');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [intervalSeconds, setIntervalSeconds] = useState(settings.interval_seconds || '30');
  const [batchSize, setBatchSize] = useState(settings.batch_size || '10');
  const [batchPauseSeconds, setBatchPauseSeconds] = useState(settings.batch_pause_seconds || '30');
  const [skipAlreadyMessaged, setSkipAlreadyMessaged] = useState(
    settings.skip_already_messaged !== '0'
  );
  const [savingSpeed, setSavingSpeed] = useState(false);
  const [speedSaved, setSpeedSaved] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setBodyText(draft.body_text || '');
  }, [draft.body_text]);

  useEffect(() => {
    setIntervalSeconds(settings.interval_seconds || '30');
    setBatchSize(settings.batch_size || '10');
    setBatchPauseSeconds(settings.batch_pause_seconds || '30');
    setSkipAlreadyMessaged(settings.skip_already_messaged !== '0');
  }, [settings]);

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setErrorMsg(null);
    try {
      const updated = await api.saveDraftText(bodyText);
      onDraftChange(updated);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save message');
    } finally {
      setSavingDraft(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setBodyText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    const next = bodyText.slice(0, start) + emoji + bodyText.slice(end);
    setBodyText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const handleAttachmentSelect = async (file: File | null) => {
    if (!file) return;
    setUploadingFile(true);
    setErrorMsg(null);
    try {
      // Save text first so nothing is lost
      await api.saveDraftText(bodyText);
      const updated = await api.uploadAttachment(file);
      onDraftChange(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Attachment upload failed');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveAttachment = async () => {
    setUploadingFile(true);
    setErrorMsg(null);
    try {
      const updated = await api.removeAttachment();
      onDraftChange(updated);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to remove attachment');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSaveSpeedSettings = async (updates: Partial<AppSettings>) => {
    setSavingSpeed(true);
    try {
      const next = await api.saveSettings(updates);
      onSettingsChange(next);
      setSpeedSaved(true);
      setTimeout(() => setSpeedSaved(false), 1800);
    } finally {
      setSavingSpeed(false);
    }
  };

  const lineCount = bodyText ? bodyText.split(/\r?\n/).length : 0;

  return (
    <div className="space-y-6">
      <div className="border-b border-[#E2E8E4] pb-4">
        <h2 className="text-lg font-semibold text-[#0F1D17]">Message Composer & Speed Settings</h2>
        <p className="text-sm text-[#475A51]">
          Write multi-line messages with emojis, attach images, PDFs, or MP4 videos, and configure safe sending intervals.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left: Message Composer + Attachments */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#0F1D17]">Message Content</h3>
                <p className="text-xs text-[#73857C]">
                  Supports multi-line text, emojis, and optional attachment caption
                </p>
              </div>

              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4DDD8] bg-white px-3 py-1.5 text-xs font-medium text-[#0F1D17] hover:bg-[#F6F8F7] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Smile className="h-3.5 w-3.5 text-[#0D8A4E]" />
                  Insert Emoji
                </button>

                {showEmojiPicker && (
                  <div className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-[#E2E8E4] bg-white p-3 shadow-lg">
                    <div className="mb-2 flex items-center justify-between text-xs text-[#73857C]">
                      <span>Quick Emojis</span>
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(false)}
                        className="text-[#475A51] hover:text-[#0F1D17] cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                    <div className="grid grid-cols-8 gap-1">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#E8F6EE] text-base cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              rows={9}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              onBlur={handleSaveDraft}
              placeholder="Write your WhatsApp message here...&#10;&#10;You can include multiple paragraphs, links, and emojis."
              className="w-full rounded-lg border border-[#D4DDD8] bg-white px-4 py-3 text-sm leading-relaxed text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-3 text-xs text-[#73857C] font-mono tabular-nums">
                <span>{bodyText.length} chars</span>
                <span aria-hidden="true">·</span>
                <span>{lineCount} lines</span>
              </div>

              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={savingDraft}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-4 py-2 text-xs font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {savedNotice ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {savedNotice ? 'Draft Saved' : 'Save Draft'}
              </button>
            </div>
          </div>

          {/* Attachment Upload */}
          <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#0F1D17]">Media & Document Attachment</h3>
                <p className="text-xs text-[#73857C]">
                  Optional: attach JPG, JPEG, PNG image, PDF document, or MP4 video (max 50 MB)
                </p>
              </div>
              {draft.attachment_name && (
                <button
                  type="button"
                  onClick={handleRemoveAttachment}
                  disabled={uploadingFile}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>

            {!draft.attachment_name ? (
              <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#B7C7BE] bg-[#F8FAF9] px-6 py-7 text-center cursor-pointer hover:border-[#0D8A4E] transition-colors">
                <Paperclip className="h-6 w-6 text-[#0D8A4E]" />
                <span className="mt-2 text-sm font-medium text-[#0F1D17]">
                  {uploadingFile ? 'Uploading attachment...' : 'Click to attach Image, PDF, or MP4 Video'}
                </span>
                <span className="mt-1 text-xs text-[#73857C]">
                  Allowed formats: .jpg, .jpeg, .png, .pdf, .mp4
                </span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,.mp4,image/jpeg,image/png,application/pdf,video/mp4"
                  className="hidden"
                  disabled={uploadingFile}
                  onChange={(e) => handleAttachmentSelect(e.target.files?.[0] || null)}
                />
              </label>
            ) : (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-[#E2E8E4] bg-[#F8FAF9] px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  {draft.attachment_type === 'image' ? (
                    <ImageIcon className="h-5 w-5 shrink-0 text-[#0D8A4E]" />
                  ) : draft.attachment_type === 'pdf' ? (
                    <FileText className="h-5 w-5 shrink-0 text-[#0D8A4E]" />
                  ) : (
                    <Film className="h-5 w-5 shrink-0 text-[#0D8A4E]" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0F1D17]">
                      {draft.attachment_name}
                    </p>
                    <p className="font-mono text-xs text-[#73857C] tabular-nums">
                      {draft.attachment_type?.toUpperCase()} · {formatBytes(draft.attachment_size)}
                    </p>
                  </div>
                </div>

                <label className="rounded-lg border border-[#D4DDD8] bg-white px-3 py-1.5 text-xs font-medium text-[#0F1D17] hover:bg-[#F6F8F7] whitespace-nowrap shrink-0 cursor-pointer">
                  Replace File
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,.mp4,image/jpeg,image/png,application/pdf,video/mp4"
                    className="hidden"
                    disabled={uploadingFile}
                    onChange={(e) => handleAttachmentSelect(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Right: Live Message Preview + Speed Controls */}
        <div className="lg:col-span-5 space-y-6">
          {/* Preview Panel */}
          <div className="rounded-xl border border-[#E2E8E4] bg-white overflow-hidden">
            <div className="border-b border-[#E2E8E4] bg-[#0B6B3A] px-5 py-3 text-white">
              <p className="text-xs font-medium opacity-85">Live Recipient Preview</p>
              <p className="text-sm font-semibold">WhatsApp Message Preview</p>
            </div>

            <div className="bg-[#EFEAE2] p-5 min-h-[220px] flex flex-col justify-end">
              {!bodyText.trim() && !draft.attachmentUrl ? (
                <p className="text-center text-xs text-[#6B7280] py-10">
                  Type a message or attach a file to preview how it will appear in WhatsApp.
                </p>
              ) : (
                <div className="ml-auto max-w-[90%] rounded-xl rounded-tr-xs bg-[#D9FDD3] p-2.5 text-sm text-[#111B21] shadow-xs space-y-2">
                  {draft.attachmentUrl && draft.attachment_type === 'image' && (
                    <img
                      src={apiUrl(draft.attachmentUrl)}
                      alt={draft.attachment_name || 'Attachment preview'}
                      className="max-h-56 w-full rounded-lg object-cover bg-white"
                      referrerPolicy="no-referrer"
                    />
                  )}

                  {draft.attachmentUrl && draft.attachment_type === 'video' && (
                    <video
                      src={apiUrl(draft.attachmentUrl)}
                      controls
                      className="max-h-56 w-full rounded-lg bg-black"
                    />
                  )}

                  {draft.attachmentUrl && draft.attachment_type === 'pdf' && (
                    <div className="rounded-lg border border-[#BCE3B7] bg-white/80 p-3 space-y-2">
                      <div className="flex items-center gap-2.5">
                        <FileText className="h-5 w-5 shrink-0 text-red-600" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[#111B21]">
                            {draft.attachment_name}
                          </p>
                          <p className="font-mono text-[11px] text-[#54656F] tabular-nums">
                            PDF Document · {formatBytes(draft.attachment_size)}
                          </p>
                        </div>
                      </div>
                      <iframe
                        src={apiUrl(draft.attachmentUrl)}
                        title="PDF attachment preview"
                        className="h-36 w-full rounded border border-[#E2E8E4] bg-white"
                      />
                    </div>
                  )}

                  {bodyText.trim() && (
                    <p className="whitespace-pre-wrap break-words px-1 text-[13.5px] leading-relaxed">
                      {bodyText}
                    </p>
                  )}

                  <div className="flex justify-end px-1 text-[10px] text-[#54656F] font-mono tabular-nums">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Speed Settings Panel */}
          <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#E2E8E4] pb-3.5">
              <div className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-[#0D8A4E]" />
                <h3 className="text-sm font-semibold text-[#0F1D17]">Message Sending Speed</h3>
              </div>
              {speedSaved && (
                <span className="text-xs font-medium text-[#0D8A4E]">Saved</span>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="interval-select" className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                  Delay Between Each Message
                </label>
                <select
                  id="interval-select"
                  value={intervalSeconds}
                  disabled={savingSpeed}
                  onChange={(e) => {
                    const val = e.target.value;
                    setIntervalSeconds(val);
                    void handleSaveSpeedSettings({ interval_seconds: val });
                  }}
                  className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="batch-size-select" className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                    Batch Frequency
                  </label>
                  <select
                    id="batch-size-select"
                    value={batchSize}
                    disabled={savingSpeed}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBatchSize(val);
                      void handleSaveSpeedSettings({ batch_size: val });
                    }}
                    className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                  >
                    {BATCH_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="batch-pause-select" className="block text-xs font-medium text-[#0F1D17] mb-1.5">
                    Pause Duration
                  </label>
                  <select
                    id="batch-pause-select"
                    value={batchPauseSeconds}
                    disabled={savingSpeed}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBatchPauseSeconds(val);
                      void handleSaveSpeedSettings({ batch_pause_seconds: val });
                    }}
                    className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                  >
                    {BATCH_PAUSE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipAlreadyMessaged}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSkipAlreadyMessaged(checked);
                    void handleSaveSpeedSettings({
                      skip_already_messaged: checked ? '1' : '0',
                    });
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-[#D4DDD8] accent-[#0D8A4E]"
                />
                <span className="text-xs text-[#475A51] leading-relaxed">
                  <strong className="font-medium text-[#0F1D17]">Prevent duplicate sending:</strong> automatically skip numbers already messaged in previous campaigns.
                </span>
              </label>
            </div>

            <div className="rounded-lg border border-[#E2E8E4] bg-[#F8FAF9] p-3.5 text-xs text-[#475A51] flex items-start gap-2.5">
              <ShieldAlert className="h-4 w-4 shrink-0 text-[#0D8A4E] mt-0.5" />
              <p className="leading-relaxed">
                Conservative pacing helps maintain reliable delivery, but timing settings do not override WhatsApp anti-spam protections. Only message opted-in recipients and honor opt-out requests immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
