import {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  type CountryCode,
} from 'libphonenumber-js';

export interface ParsedPhoneResult {
  raw: string;
  e164: string | null;
  countryCode: string | null;
  isValid: boolean;
  isDuplicate?: boolean;
  error: string | null;
}

export interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}

const regionDisplay = new Intl.DisplayNames(['en'], { type: 'region' });

export function getCountryOptions(): CountryOption[] {
  return getCountries()
    .map((code) => {
      let name = code as string;
      try {
        name = regionDisplay.of(code) || code;
      } catch {
        name = code;
      }
      return {
        code,
        name,
        dialCode: `+${getCountryCallingCode(code)}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function cleanPhoneInput(raw: string): string {
  // Remove invisible bidi/BOM marks, quotes, and surrounding whitespace
  let cleaned = raw
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF"']/g, '')
    .trim();

  if (cleaned.startsWith('00') && cleaned.length > 6) {
    cleaned = '+' + cleaned.slice(2);
  }
  return cleaned;
}

export function validateAndNormalizePhone(
  rawInput: string,
  defaultCountry: CountryCode = 'US'
): ParsedPhoneResult {
  const raw = rawInput.trim();
  if (!raw) {
    return {
      raw,
      e164: null,
      countryCode: null,
      isValid: false,
      error: 'Empty phone number',
    };
  }

  const cleaned = cleanPhoneInput(raw);
  const digitsOnly = cleaned.replace(/[^\d+]/g, '');

  if (digitsOnly.replace(/\D/g, '').length < 6) {
    return {
      raw,
      e164: null,
      countryCode: null,
      isValid: false,
      error: 'Number too short',
    };
  }

  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed) {
    return {
      raw,
      e164: null,
      countryCode: null,
      isValid: false,
      error: 'Unrecognized phone format',
    };
  }

  if (!parsed.isPossible()) {
    return {
      raw,
      e164: null,
      countryCode: parsed.country || defaultCountry,
      isValid: false,
      error: `Invalid length for ${parsed.country || defaultCountry}`,
    };
  }

  if (!parsed.isValid()) {
    return {
      raw,
      e164: null,
      countryCode: parsed.country || defaultCountry,
      isValid: false,
      error: `Invalid phone number pattern for ${parsed.country || defaultCountry}`,
    };
  }

  return {
    raw,
    e164: parsed.number,
    countryCode: parsed.country || defaultCountry,
    isValid: true,
    error: null,
  };
}

export function processBatchPhoneLines(
  lines: string[],
  defaultCountry: CountryCode,
  existingE164Set: Set<string> = new Set()
): {
  entries: ParsedPhoneResult[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
} {
  const seenInBatch = new Set<string>();
  const entries: ParsedPhoneResult[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const result = validateAndNormalizePhone(trimmed, defaultCountry);
    if (!result.isValid || !result.e164) {
      invalidCount++;
      entries.push(result);
      continue;
    }

    if (seenInBatch.has(result.e164) || existingE164Set.has(result.e164)) {
      duplicateCount++;
      entries.push({
        ...result,
        isDuplicate: true,
        error: 'Duplicate phone number',
      });
      continue;
    }

    seenInBatch.add(result.e164);
    validCount++;
    entries.push(result);
  }

  return { entries, validCount, invalidCount, duplicateCount };
}
