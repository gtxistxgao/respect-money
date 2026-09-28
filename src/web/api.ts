import './language.js';
import { t, getLocale, intlLocale } from "../i18n/index.js";
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 1000, refetchOnWindowFocus: true } } });
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers: { 'Accept-Language': getLocale(), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } }); }
  catch (cause) { throw new Error(t('Network request failed. Check your connection and retry.'), { cause }); }
  let value: T & { error?: string };
  try { value = await response.json() as T & { error?: string }; }
  catch (cause) { throw new Error(t('The server returned an unreadable response. Please retry.'), { cause }); }
  if (!response.ok) throw new Error(value.error || t("The operation could not be completed. Please try again."));
  return value;
}
export function money(cents: number, currency = 'USD') {
  if (!/^[A-Z]{3}$/.test(currency)) return t("{p0} (unknown currency)", { p0: (cents / 100).toFixed(2) });
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(cents / 100);
}
export async function refreshData() { await queryClient.invalidateQueries(); }
export type SettingsStatus = {
  plaidConfigured: boolean; plaidEnv: string; classificationProvider: 'codex' | 'claude'; cliVersion: string | null; codexVersion: string | null;
  connections: { id: string; institution: string; institutionId?: string; products: string[]; status: string; lastSyncedAt?: string; lastError?: string }[];
  jobs: { id: string; type: string; status: string; message: string; progress: number; total: number; errors: string[]; createdAt: string }[];
  staleAccountIds: string[];
};
export type AccountCoverage = { accountId: string; accountName: string; accountMask: string; ranges: { start: string; end: string }[]; firstRecord: string | null; lastRecord: string | null; recordCount: number; historyStatus: string; lastSyncedAt: string | null; completeness: 'unknown' };
