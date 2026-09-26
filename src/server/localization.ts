import type { ZodIssue } from 'zod';
import { isMessage, renderMessage, translate, type Locale } from '../i18n/index.js';

// Only application messages are localized. Financial descriptions, notes,
// identifiers and raw provider payloads are never rewritten.
export function localizeResponse(value: unknown, locale: Locale, field = ''): unknown {
  if (typeof value === 'string') return ['error', 'message', 'errors', 'lastError', 'reason'].includes(field) ? renderMessage(value, locale) : value;
  if (Array.isArray(value)) return value.map((entry) => localizeResponse(entry, locale, field));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ['raw', 'payload', 'override'].includes(key) ? entry : localizeResponse(entry, locale, key)]));
  return value;
}
export function validationMessage(issue: ZodIssue, locale: Locale) {
  if (isMessage(issue.message)) return renderMessage(issue.message, locale);
  switch (issue.code) {
    case 'invalid_type': return translate(locale, 'Expected {p0}.', { p0: translate(locale, `validation.type.${issue.expected}`) });
    case 'too_small': return translate(locale, 'The minimum is {p0}.', { p0: String(issue.minimum) });
    case 'too_big': return translate(locale, 'The maximum is {p0}.', { p0: String(issue.maximum) });
    case 'invalid_value': return translate(locale, 'Choose one of: {p0}.', { p0: issue.values.map(String).join(', ') });
    case 'invalid_format': return translate(locale, 'Invalid format.');
    default: return translate(locale, 'Invalid value.');
  }
}

const fieldLabels: Record<string, string> = { plaidEnv: 'Plaid environment', plaidClientId: 'Plaid client ID', plaidSecret: 'Plaid secret', plaidRedirectUri: 'Plaid redirect URL (optional)', codexModel: 'Classification model', classificationPrompt: 'Transaction classification prompt', codexBin: 'Codex CLI executable', codexTimeoutMs: 'Classification timeout (milliseconds)', port: 'Server port', revision: 'Version', name: 'Account name', institution: 'Institution name', accountId: 'Account', postedDate: 'Posting date', amount: 'Amount', kind: 'Transaction type', category: 'Category', country: 'Country', notes: 'Notes (optional)', version: 'Version', range: 'Date range', start: 'Start date', end: 'End date' };
export function validationPath(issue: ZodIssue, locale: Locale) { return issue.path.map((part) => translate(locale, fieldLabels[String(part)] || String(part))).join('.'); }
