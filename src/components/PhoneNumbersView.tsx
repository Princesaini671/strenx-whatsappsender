import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../api.ts';
import type { ContactItem, CountryOption, CsvPreviewResponse } from '../types.ts';

interface PhoneNumbersViewProps {
  contacts: ContactItem[];
  countries: CountryOption[];
  defaultCountry: string;
  onContactsChanged: () => void;
  onDefaultCountryChanged: (code: string) => void;
}

type EntryMode = 'manual' | 'paste' | 'csv';

export function PhoneNumbersView({
  contacts,
  countries,
  defaultCountry,
  onContactsChanged,
  onDefaultCountryChanged,
}: PhoneNumbersViewProps) {
  const [entryMode, setEntryMode] = useState<EntryMode>('manual');
  const [countryCode, setCountryCode] = useState(defaultCountry || 'US');
  const [busy, setBusy] = useState(false);

  // Manual entry
  const [manualInput, setManualInput] = useState('');

  // Bulk paste
  const [bulkText, setBulkText] = useState('');

  // CSV upload
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResponse | null>(null);
  const [selectedCsvColumn, setSelectedCsvColumn] = useState<string>('');

  // Feedback banner
  const [resultBanner, setResultBanner] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string[];
  } | null>(null);

  // Table search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'manual' | 'paste' | 'csv'>('all');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const handleCountryChange = async (next: string) => {
    setCountryCode(next);
    onDefaultCountryChanged(next);
    if (csvFile) {
      try {
        const preview = await api.previewCsvContacts(csvFile, next, selectedCsvColumn || undefined);
        setCsvPreview(preview);
        setSelectedCsvColumn(preview.selectedColumn);
      } catch {
        // ignore preview refresh failure
      }
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    setBusy(true);
    setResultBanner(null);
    try {
      const res = await api.addManualContacts(manualInput, countryCode);
      setManualInput('');
      onContactsChanged();
      setResultBanner({
        type: res.inserted > 0 ? 'success' : 'error',
        message: `Added ${res.inserted} valid number${res.inserted === 1 ? '' : 's'} · ${res.invalidCount} invalid · ${res.duplicateCount} duplicate skipped`,
        details: res.invalidEntries.slice(0, 5).map((item) => `${item.raw}: ${item.error}`),
      });
    } catch (err) {
      setResultBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to add numbers',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkPasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkText.trim()) return;
    setBusy(true);
    setResultBanner(null);
    try {
      const res = await api.bulkPasteContacts(bulkText, countryCode);
      setBulkText('');
      onContactsChanged();
      setResultBanner({
        type: res.inserted > 0 ? 'success' : 'error',
        message: `Processed ${res.totalLines} lines: ${res.inserted} imported · ${res.duplicateCount} duplicates removed · ${res.invalidCount} invalid`,
        details: res.invalidEntries.slice(0, 6).map((item) => `${item.raw}: ${item.error}`),
      });
    } catch (err) {
      setResultBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Bulk paste failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCsvFileChange = async (file: File | null) => {
    setCsvFile(file);
    setCsvPreview(null);
    setResultBanner(null);
    if (!file) return;

    setBusy(true);
    try {
      const preview = await api.previewCsvContacts(file, countryCode);
      setCsvPreview(preview);
      setSelectedCsvColumn(preview.selectedColumn);
    } catch (err) {
      setResultBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to parse CSV file',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCsvColumnChange = async (col: string) => {
    setSelectedCsvColumn(col);
    if (!csvFile) return;
    setBusy(true);
    try {
      const preview = await api.previewCsvContacts(csvFile, countryCode, col);
      setCsvPreview(preview);
    } catch (err) {
      setResultBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update CSV column preview',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmCsvImport = async () => {
    if (!csvFile) return;
    setBusy(true);
    setResultBanner(null);
    try {
      const res = await api.importCsvContacts(csvFile, countryCode, selectedCsvColumn || undefined);
      setCsvFile(null);
      setCsvPreview(null);
      onContactsChanged();
      setResultBanner({
        type: res.inserted > 0 ? 'success' : 'error',
        message: `CSV Import complete: ${res.inserted} valid imported · ${res.duplicateCount} duplicates skipped · ${res.invalidCount} invalid`,
      });
    } catch (err) {
      setResultBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'CSV import failed',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteContact = async (id: number) => {
    await api.deleteContact(id);
    onContactsChanged();
  };

  const handleClearAll = async () => {
    await api.clearAllContacts();
    setConfirmClearAll(false);
    onContactsChanged();
  };

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter((c) => {
      if (sourceFilter !== 'all' && c.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        c.phone_e164.toLowerCase().includes(q) ||
        c.raw_input.toLowerCase().includes(q) ||
        (c.country_code || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, searchQuery, sourceFilter]);

  const pasteLineCount = useMemo(
    () => bulkText.split(/\r?\n/).filter((l) => l.trim().length > 0).length,
    [bulkText]
  );

  return (
    <div className="space-y-6">
      {/* Header + Default Country Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] pb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#0F1D17]">Phone Number List</h2>
          <p className="text-sm text-[#475A51]">
            Add numbers manually, paste up to 1,000+ lines at once, or import from a CSV spreadsheet.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <label htmlFor="country-select" className="text-xs font-medium text-[#475A51] whitespace-nowrap">
            Default Country Code
          </label>
          <select
            id="country-select"
            value={countryCode}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="rounded-lg border border-[#D4DDD8] bg-white px-3 py-2 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.dialCode})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Input Method Tabs */}
      <div className="rounded-xl border border-[#E2E8E4] bg-white p-6 space-y-5">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-[#EDF2EF] p-1">
          <button
            type="button"
            onClick={() => setEntryMode('manual')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              entryMode === 'manual' ? 'bg-white text-[#0F1D17] shadow-xs' : 'text-[#475A51] hover:text-[#0F1D17]'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            Option A: Manual Entry
          </button>
          <button
            type="button"
            onClick={() => setEntryMode('paste')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              entryMode === 'paste' ? 'bg-white text-[#0F1D17] shadow-xs' : 'text-[#475A51] hover:text-[#0F1D17]'
            }`}
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Option B: Bulk Paste
          </button>
          <button
            type="button"
            onClick={() => setEntryMode('csv')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              entryMode === 'csv' ? 'bg-white text-[#0F1D17] shadow-xs' : 'text-[#475A51] hover:text-[#0F1D17]'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Option C: CSV Import
          </button>
        </div>

        {resultBanner && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              resultBanner.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {resultBanner.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0D8A4E]" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              )}
              <span>{resultBanner.message}</span>
            </div>
            {resultBanner.details && resultBanner.details.length > 0 && (
              <ul className="mt-2 list-disc pl-6 font-mono text-xs space-y-0.5 opacity-90">
                {resultBanner.details.map((d, idx) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Option A: Manual Entry */}
        {entryMode === 'manual' && (
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <label className="block text-xs font-medium text-[#475A51]">
              Enter a single phone number or paste multiple numbers (separated by comma or new line)
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <textarea
                rows={3}
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="+1 415 890 1234&#10;415-890-5678, +44 7911 123456"
                className="flex-1 rounded-lg border border-[#D4DDD8] bg-white px-3.5 py-2.5 font-mono text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !manualInput.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0D8A4E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add Numbers
              </button>
            </div>
          </form>
        )}

        {/* Option B: Bulk Paste */}
        {entryMode === 'paste' && (
          <form onSubmit={handleBulkPasteSubmit} className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[#475A51]">
              <span>Paste 100, 500, or 1,000+ phone numbers (one number per line)</span>
              <span className="font-mono tabular-nums">{pasteLineCount} lines detected</span>
            </div>
            <textarea
              rows={8}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="+14158901234&#10;4158905678&#10;+919876543210&#10;+447911123456"
              className="w-full rounded-lg border border-[#D4DDD8] bg-white px-3.5 py-2.5 font-mono text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[#73857C]">
                Numbers without a country prefix will use your selected country ({countryCode}). Duplicates are automatically removed.
              </p>
              <button
                type="submit"
                disabled={busy || pasteLineCount === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ClipboardPaste className="h-4 w-4" />
                Validate & Import Paste
              </button>
            </div>
          </form>
        )}

        {/* Option C: CSV Import */}
        {entryMode === 'csv' && (
          <div className="space-y-4">
            <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#B7C7BE] bg-[#F8FAF9] px-6 py-8 text-center cursor-pointer hover:border-[#0D8A4E] transition-colors">
              <Upload className="h-7 w-7 text-[#0D8A4E]" />
              <span className="mt-2 text-sm font-medium text-[#0F1D17]">
                {csvFile ? csvFile.name : 'Choose a CSV file to upload'}
              </span>
              <span className="mt-1 text-xs text-[#73857C]">
                Supports standard .csv spreadsheets with phone / mobile / WhatsApp columns
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleCsvFileChange(e.target.files?.[0] || null)}
              />
            </label>

            {csvPreview && (
              <div className="space-y-4 border-t border-[#E2E8E4] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div>
                      <span className="text-xs text-[#73857C]">Total Rows: </span>
                      <span className="font-mono font-semibold text-[#0F1D17] tabular-nums">
                        {csvPreview.totalRows}
                      </span>
                    </div>
                    <span className="text-[#D4DDD8]">/</span>
                    <div>
                      <span className="text-xs text-[#73857C]">Valid: </span>
                      <span className="font-mono font-semibold text-[#0D8A4E] tabular-nums">
                        {csvPreview.validCount}
                      </span>
                    </div>
                    <span className="text-[#D4DDD8]">/</span>
                    <div>
                      <span className="text-xs text-[#73857C]">Invalid: </span>
                      <span className="font-mono font-semibold text-red-600 tabular-nums">
                        {csvPreview.invalidCount}
                      </span>
                    </div>
                    <span className="text-[#D4DDD8]">/</span>
                    <div>
                      <span className="text-xs text-[#73857C]">Duplicates: </span>
                      <span className="font-mono font-semibold text-amber-700 tabular-nums">
                        {csvPreview.duplicateCount}
                      </span>
                    </div>
                  </div>

                  {csvPreview.hasHeaders && csvPreview.headers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-[#475A51]">Phone Column:</label>
                      <select
                        value={selectedCsvColumn}
                        onChange={(e) => handleCsvColumnChange(e.target.value)}
                        className="rounded-lg border border-[#D4DDD8] bg-white px-3 py-1.5 text-sm text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
                      >
                        {csvPreview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Preview Table */}
                <div className="max-h-60 overflow-auto rounded-lg border border-[#E2E8E4]">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[#F6F8F7] text-[#475A51] border-b border-[#E2E8E4]">
                      <tr>
                        <th className="px-3.5 py-2 font-medium">Raw Input</th>
                        <th className="px-3.5 py-2 font-medium">Normalized (E.164)</th>
                        <th className="px-3.5 py-2 font-medium">Country</th>
                        <th className="px-3.5 py-2 font-medium">Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF2EF]">
                      {csvPreview.previewRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-[#F8FAF9]">
                          <td className="px-3.5 py-2 font-mono text-[#475A51]">{row.raw}</td>
                          <td className="px-3.5 py-2 font-mono font-medium text-[#0F1D17]">
                            {row.e164 || '—'}
                          </td>
                          <td className="px-3.5 py-2 text-[#475A51]">{row.countryCode || '—'}</td>
                          <td className="px-3.5 py-2">
                            {row.isDuplicate ? (
                              <span className="text-amber-700 font-medium">Duplicate</span>
                            ) : row.isValid ? (
                              <span className="text-[#0D8A4E] font-medium">Valid</span>
                            ) : (
                              <span className="text-red-600">{row.error || 'Invalid'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setCsvFile(null);
                      setCsvPreview(null);
                    }}
                    className="rounded-lg border border-[#D4DDD8] bg-white px-4 py-2 text-sm font-medium text-[#475A51] hover:text-[#0F1D17] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmCsvImport}
                    disabled={busy || csvPreview.validCount === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0D8A4E] px-5 py-2 text-sm font-medium text-white hover:bg-[#0A6E3E] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Import {csvPreview.validCount} Valid Numbers
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Imported Numbers Table */}
      <div className="rounded-xl border border-[#E2E8E4] bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8E4] px-6 py-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-[#0F1D17]">Imported Numbers</h3>
            <span className="text-xs text-[#73857C] font-mono tabular-nums">
              {contacts.length} total
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#73857C]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search numbers..."
                className="w-48 rounded-lg border border-[#D4DDD8] bg-white pl-8 pr-3 py-1.5 text-xs text-[#0F1D17] focus:border-[#0D8A4E] focus:outline-none"
              />
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-[#EDF2EF] p-0.5 text-xs">
              {(['all', 'manual', 'paste', 'csv'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceFilter(src)}
                  className={`rounded-md px-2.5 py-1 font-medium capitalize whitespace-nowrap shrink-0 cursor-pointer ${
                    sourceFilter === src
                      ? 'bg-white text-[#0F1D17] shadow-xs'
                      : 'text-[#475A51] hover:text-[#0F1D17]'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>

            {contacts.length > 0 &&
              (!confirmClearAll ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear All
                </button>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1">
                  <span className="text-xs font-medium text-red-800">Delete all {contacts.length}?</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 cursor-pointer"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="text-xs text-[#475A51] hover:text-[#0F1D17] cursor-pointer"
                  >
                    No
                  </button>
                </div>
              ))}
          </div>
        </div>

        {filteredContacts.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-[#0F1D17]">
              {contacts.length === 0 ? 'No phone numbers imported yet' : 'No matching phone numbers'}
            </p>
            <p className="mt-1 text-xs text-[#73857C]">
              {contacts.length === 0
                ? 'Use Manual Entry, Bulk Paste, or CSV Import above to build your recipient list.'
                : 'Try adjusting your search or source filter.'}
            </p>
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-[#F6F8F7] text-xs text-[#475A51] border-b border-[#E2E8E4]">
                <tr>
                  <th className="px-5 py-2.5 font-medium">#</th>
                  <th className="px-5 py-2.5 font-medium">Phone Number</th>
                  <th className="px-5 py-2.5 font-medium">Country</th>
                  <th className="px-5 py-2.5 font-medium">Source</th>
                  <th className="px-5 py-2.5 font-medium">History</th>
                  <th className="px-5 py-2.5 font-medium">Added</th>
                  <th className="px-5 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2EF]">
                {filteredContacts.map((contact, idx) => (
                  <tr key={contact.id} className="hover:bg-[#F8FAF9] h-10">
                    <td className="px-5 py-2 font-mono text-xs text-[#73857C] tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-5 py-2 font-mono font-medium text-[#0F1D17] tabular-nums">
                      {contact.phone_e164}
                    </td>
                    <td className="px-5 py-2 text-xs text-[#475A51]">
                      {contact.country_code || '—'}
                    </td>
                    <td className="px-5 py-2 text-xs capitalize text-[#475A51]">
                      {contact.source}
                    </td>
                    <td className="px-5 py-2 text-xs">
                      {contact.previouslyMessaged ? (
                        <span className="text-amber-700 font-medium">Previously messaged</span>
                      ) : (
                        <span className="text-[#0D8A4E]">Ready</span>
                      )}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-[#73857C] tabular-nums">
                      {new Date(contact.created_at + 'Z').toLocaleDateString()}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteContact(contact.id)}
                        aria-label={`Remove ${contact.phone_e164}`}
                        className="inline-flex items-center justify-center rounded p-1 text-[#73857C] hover:bg-red-50 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
