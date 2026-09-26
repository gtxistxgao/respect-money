import { t } from "../../../i18n/index.js";
import { useEffect, useRef, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { api, refreshData, type SettingsStatus } from '../../api.js';
import { ErrorNotice, Modal } from '../../components.js';
import type { LinkCompletion } from '../../../shared/banking.js';
import { InstitutionTable } from './InstitutionTable.js';
import { today } from '../../../shared/models.js';

type LinkSession = { linkToken: string; sessionId: string; connectionId?: string };
const sessionKey = 'respect-money-link-session';
function restoreSession(): LinkSession | undefined {
  if (!new URLSearchParams(window.location.search).has('oauth_state_id')) return;
  try { const value = JSON.parse(sessionStorage.getItem(sessionKey) || 'null') as LinkSession | null; if (value?.linkToken && value.sessionId) return value; } catch { /* A new Link flow will replace invalid browser state. */ }
}
export function BankLinkControls() {
  const [session, setSession] = useState<LinkSession | undefined>(restoreSession);
  const [error, setError] = useState<unknown>(); const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState<SettingsStatus['connections'][number]>();
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<unknown>();
  const [disconnected, setDisconnected] = useState('');
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<SettingsStatus>('/settings/status') });
  async function begin(connectionId?: string) {
    setError(undefined); setLoading(true); setChoosing(false);
    try { const result = await api<LinkSession>('/plaid/link-token', { method: 'POST', body: JSON.stringify({ connectionId }) }); const next = { ...result, connectionId }; sessionStorage.setItem(sessionKey, JSON.stringify(next)); setSession(next); }
    catch (e) { setError(e); } finally { setLoading(false); }
  }
  function close(error?: unknown) { setSession(undefined); sessionStorage.removeItem(sessionKey); if (error) setError(error); if (window.location.search.includes('oauth_state_id')) window.history.replaceState({}, '', '/settings'); }
  async function disconnect() {
    if (!removing) return;
    setDisconnecting(true); setDisconnectError(undefined);
    try {
      await api(`/plaid/connections/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      setDisconnected(removing.institution); setRemoving(undefined); await refreshData();
    } catch (reason) { setDisconnectError(reason); }
    finally { setDisconnecting(false); }
  }
  const locked = loading || Boolean(session) || disconnecting;
  const products = (connection: SettingsStatus['connections'][number]) => connection.products.map(product => product === 'transactions' ? t('Bank transactions') : product === 'investments' ? t('Investments') : product).join(' · ') || '—';
  return <div className="bank-link-controls"><ErrorNotice error={error} />
    {disconnected && <p className="connection-help" role="status">{t('Disconnected from {p0}.', { p0: disconnected })}</p>}
    <div className="bank-actions"><button className="button primary" disabled={locked || !status.data?.plaidConfigured} onClick={() => status.data?.connections.length ? setChoosing(true) : void begin()}><Plus size={15} />{t('Connect accounts')}</button></div>
    {status.data?.connections.length ? <InstitutionTable rows={status.data.connections} label={t('Bank connections')} className="settings-connections-table" columns={[
      { key: 'institution', label: 'Institution name', value: connection => connection.institution, render: connection => connection.institution },
      { key: 'products', label: 'Authorized data', value: products, render: products },
      { key: 'status', label: 'Connection status', value: connection => connection.status === 'connected' ? t('Connected') : t('Reconnect required'), render: connection => <><span className={`connection-status ${connection.status === 'connected' ? 'connected' : 'attention'}`}>{connection.status === 'connected' ? t('Connected') : t('Reconnect required')}</span>{connection.lastError && <small>{connection.lastError}</small>}</> },
      { key: 'actions', label: 'Actions', render: connection => <div className="connection-row-actions"><button className="button secondary" disabled={locked} aria-label={t(connection.status === 'connected' ? 'Manage accounts at {p0}' : 'Reconnect {p0}', { p0: connection.institution })} onClick={() => void begin(connection.id)}><RefreshCw size={12} />{connection.status === 'connected' ? t('Manage accounts') : t('Reconnect')}</button><button className="button secondary disconnect-button" disabled={locked} aria-label={t('Disconnect {p0}', { p0: connection.institution })} onClick={() => { setDisconnectError(undefined); setRemoving(connection); }}>{t('Disconnect')}</button></div> },
    ]} /> : <div className="settings-empty">{t('No bank connected yet. You can start with a manual account.')}</div>}
    {choosing && <Modal title={t('Connect accounts')} onClose={() => setChoosing(false)}><div className="form-body"><p>{t('To add accounts at an institution already connected, use its existing connection.')}</p><div className="connection-choices">{status.data?.connections.map((connection) => <button className="button secondary" key={connection.id} onClick={() => void begin(connection.id)}><span>{connection.institution}</span><span>{t('Manage accounts')}</span></button>)}</div><button className="button primary" onClick={() => void begin()}><Plus size={15} />{t('Connect another institution')}</button></div></Modal>}
    {session && <PlaidSession session={session} onClose={close} />}
    {removing && <Modal title={t('Disconnect {p0}', { p0: removing.institution })} onClose={() => setRemoving(undefined)} dismissible={!disconnecting}><div className="form-body">
      <ErrorNotice error={disconnectError} />
      <p>{removing.institution} · {products(removing)}</p>
      <p>{t('Disconnect and permanently delete all accounts on this connection? Their transactions, categories, notes, sync records and balance history will be removed from this app. This cannot be undone.')}</p>
      <p className="muted small">{t('Linked loans will keep their last known balance as manual debt.')}</p>
      <div className="form-actions"><button className="button secondary" disabled={disconnecting} onClick={() => setRemoving(undefined)}>{t('Cancel')}</button><button className="button danger" disabled={disconnecting} onClick={() => void disconnect()}>{disconnecting ? t('Disconnecting…') : t('Disconnect')}</button></div>
    </div></Modal>}
  </div>;
}
function PlaidSession({ session, onClose }: { session: LinkSession; onClose: (error?: unknown) => void }) {
  const opened = useRef(false); const [saving, setSaving] = useState(false); const [error, setError] = useState<unknown>();
  const [completion, setCompletion] = useState<Parameters<typeof finish>[0] | undefined>();
  async function finish(input: Omit<LinkCompletion, 'sessionId'>) {
    setCompletion(input); setSaving(true); setError(undefined);
    try {
      const result = await api<{ connectionId: string; accountIds: string[] }>('/plaid/complete', { method: 'POST', body: JSON.stringify({ ...input, sessionId: session.sessionId }) });
      const ids = result.accountIds;
      await refreshData();
      if (ids.length) {
        try { await api('/jobs', { method: 'POST', body: JSON.stringify({ type: 'sync', accountIds: ids, range: { start: '2026-01-01', end: today() } }) }); }
        catch { onClose(new Error(t("Account connected, but initial synchronization has not started. Select Sync bank data on the Accounting page."))); return; }
      }
      await refreshData(); onClose();
    } catch (e) { setError(e); } finally { setSaving(false); }
  }
  const { open, ready, error: linkError } = usePlaidLink({ token: session.linkToken,
    ...(new URLSearchParams(window.location.search).has('oauth_state_id') ? { receivedRedirectUri: window.location.href } : {}),
    onSuccess: (publicToken, metadata) => { void finish({ publicToken: publicToken || '', institution: metadata.institution?.name || 'Bank', institutionId: metadata.institution?.institution_id || undefined, selectedAccountIds: metadata.accounts?.map((a) => a.id), accounts: metadata.accounts?.map((account) => ({ id: account.id, name: account.name, mask: account.mask, type: account.type || 'other' })) }); },
    onExit: (error) => { onClose(error ? new Error(error.display_message || t("Bank connection did not complete. Please try again.")) : undefined); },
  });
  useEffect(() => { if (ready && !opened.current) { opened.current = true; open(); } }, [ready, open]);
  return <div className="link-progress"><ErrorNotice error={error || (linkError ? new Error(t("Plaid Link failed to load. Check your connection and retry.")) : undefined)} />{saving ? <p>{t("Saving authorization and reading accounts…")}</p> : error && completion ? <button className="button secondary" onClick={() => void finish(completion)}>{t("Retry saving accounts")}</button> : <p>{t("Opening Plaid bank authorization…")}</p>}<button className="button text-button" onClick={() => onClose()}>{t("Close")}</button></div>;
}
