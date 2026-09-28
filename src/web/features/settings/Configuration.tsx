import { Select } from '../../Select.js';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, queryClient } from '../../api.js';
import { t } from '../../../i18n/index.js';
import type { PublicSettings, ApplicationSettings, ModelOption } from '../../../shared/settings.js';
import { ErrorNotice } from '../../components.js';

type Patch = Partial<Omit<ApplicationSettings, 'revision'>> & { clearPlaidSecret?: boolean };
export function useConfiguration() {
  const query = useQuery({ queryKey: ['configuration'], queryFn: () => api<PublicSettings>('/settings') });
  const [draft, setDraft] = useState<{ revision: number; patch: Patch }>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>();
  const update = (patch: Patch) => {
    if (!query.data) return;
    setDraft((current) => ({ revision: current?.revision ?? query.data!.revision, patch: { ...current?.patch, ...patch } }));
    setSaved(false); setError(undefined);
  };
  const save = async (immediatePatch?: Patch) => {
    if (!query.data || (!draft && !immediatePatch)) return;
    setSaving(true); setError(undefined);
    try {
      const value = await api<PublicSettings>('/settings', { method: 'PUT', body: JSON.stringify({ ...(immediatePatch ?? draft!.patch), revision: draft?.revision ?? query.data.revision }) });
      await queryClient.cancelQueries({ queryKey: ['configuration'] });
      queryClient.setQueryData(['configuration'], value);
      setDraft(current => immediatePatch && current ? { ...current, revision: value.revision } : undefined); setSaved(true);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['status'] }), queryClient.invalidateQueries({ queryKey: ['models'] }), queryClient.invalidateQueries({ queryKey: ['wealth'] })]);
    } catch (error) { setError(error); }
    finally { setSaving(false); }
  };
  return { data: query.data, values: query.data ? { ...query.data, ...draft?.patch } : undefined, draft, saving, saved,
    error: error || query.error, update, save, reload: async () => { await query.refetch(); setDraft(undefined); setError(undefined); setSaved(false); } };
}
type Configuration = ReturnType<typeof useConfiguration>;

export function ConfigurationNotice({ config }: { config: Configuration }) {
  return <><ErrorNotice error={config.error} />{config.error && <button className="button secondary" onClick={() => void config.reload()}>{t('Reload settings')}</button>}
    {config.saved && <div className="notice" role="status">{t('Settings saved. Future tasks will use the new configuration.')}</div>}
    {config.data && config.data.port !== config.data.runningPort && <div className="notice">{t('Restart the application to use port {p0}.', { p0: config.data.port })}</div>}</>;
}
export function ConfigurationFields({ config, section, busy }: { config: Configuration; section: 'currency' | 'plaid' | 'classification' | 'advanced'; busy: boolean }) {
  const values = config.values;
  const [customModel, setCustomModel] = useState(false);
  const provider = values?.classificationProvider ?? 'codex';
  const isClaude = provider === 'claude';
  const modelValue = (isClaude ? values?.claudeModel : values?.codexModel) ?? '';
  const updateModel = (model: string) => config.update(isClaude ? { claudeModel: model } : { codexModel: model });
  const models = useQuery({ queryKey: ['models', provider, isClaude ? config.data?.claudeBin : config.data?.codexBin], queryFn: () => api<ModelOption[]>(`/settings/models?provider=${provider}`), enabled: section === 'classification' && Boolean(values), staleTime: 60000, retry: false });
  if (!values) return <p className="muted">{t('Loading settings…')}</p>;
  return <fieldset className="configuration-fields" disabled={config.saving}>
    {section === 'currency' && <><div className="configuration-grid">
      <label>{t('Currency code')}<input disabled={!values.displayConversion.enabled} maxLength={3} autoCapitalize="characters" spellCheck={false} placeholder="CNY, CAD, EUR" value={values.displayConversion.currency} onChange={(event) => config.update({ displayConversion: { ...values.displayConversion, currency: event.target.value.toUpperCase() } })} /></label>
      <label>{t('Exchange rate per 1 USD')}<input disabled={!values.displayConversion.enabled} type="number" inputMode="decimal" min="0" step="any" value={values.displayConversion.rate || ''} onChange={(event) => config.update({ displayConversion: { ...values.displayConversion, rate: event.target.value === '' ? 0 : Number(event.target.value) } })} /></label>
    </div><p className="muted small">{t('Enter a three-letter currency code and the amount of that currency equal to 1 USD. Used only for display estimates; USD amounts stay unchanged.')}</p></>}
    {section === 'plaid' && <><div className="configuration-grid">
      <label>{t('Plaid environment')}<Select value={values.plaidEnv} onValueChange={(nextValue) => config.update({ plaidEnv: nextValue as ApplicationSettings['plaidEnv'] })}><option value="sandbox">{t('Sandbox')}</option><option value="production">{t('Production')}</option></Select></label>
      <label>{t('Plaid client ID')}<input autoComplete="off" value={values.plaidClientId} onChange={(event) => config.update({ plaidClientId: event.target.value })} /></label>
      <label>{t('Plaid secret')}<input type="password" autoComplete="new-password" value={config.draft?.patch.plaidSecret || ''} placeholder={values.hasPlaidSecret ? t('Saved — leave blank to keep it') : t('Enter your Plaid secret')} onChange={(event) => config.update({ plaidSecret: event.target.value, clearPlaidSecret: false })} /></label>
      <label>{t('Plaid redirect URL (optional)')}<input type="url" value={values.plaidRedirectUri} placeholder="https://" onChange={(event) => config.update({ plaidRedirectUri: event.target.value })} /></label>
    </div><p className="muted small">{t('Credentials are stored locally in SQLite. The saved secret is never sent back to the browser.')}</p>
    {values.hasPlaidSecret && <label className="configuration-checkbox"><input type="checkbox" checked={Boolean(config.draft?.patch.clearPlaidSecret)} onChange={(event) => config.update({ clearPlaidSecret: event.target.checked, plaidSecret: '' })} />{t('Remove the saved Plaid secret')}</label>}
    <p className="muted small">{t('Use the environment matching your keys. Existing bank connections are tied to their environment and client ID.')}</p></>}
    {section === 'classification' && <>
      <label>{t('Classification provider')}<Select value={provider} onValueChange={(value) => { void config.save({ classificationProvider: value as 'codex' | 'claude' }); setCustomModel(false); }}><option value="codex">Codex</option><option value="claude">Claude Code</option></Select></label>
      <p className="muted small">{t('Provider changes are saved automatically. Save other changes with Save settings.')}</p>
      <label>{t('Classification model')}<Select value={customModel ? '__manual_model__' : modelValue} onValueChange={(nextValue) => {
        const manual = nextValue === '__manual_model__'; setCustomModel(manual);
        if (!manual) updateModel(nextValue);
      }}>
        <option value="">{t('CLI default model')}</option>
        {models.data?.map((model) => <option key={model.model} value={model.model}>{model.displayName}{model.isDefault ? ` (${t('Default')})` : ''}</option>)}
        {modelValue && !models.data?.some((model) => model.model === modelValue) && <option value={modelValue}>{modelValue}</option>}
        <option value="__manual_model__">{t('Enter a model ID…')}</option>
      </Select></label>
      {customModel && <label className="custom-model-field">{t('Model ID')}<input value={modelValue} placeholder={t('CLI default model')} onChange={(event) => updateModel(event.target.value)} /></label>}
      <div className="configuration-help"><p className="muted small">{t('Choose a model or enter its ID. Leave blank to use the selected CLI default.')}</p><button className="button secondary small" disabled={models.isFetching} onClick={() => void models.refetch()}>{models.isFetching ? t('Loading models…') : t('Refresh models')}</button></div>
      <ErrorNotice error={models.error} />
      <div className="configuration-prompt-heading"><label htmlFor="classification-prompt">{t('Transaction classification prompt')}</label><button className="button secondary small" onClick={() => config.update({ classificationPrompt: values.defaultPrompt })}>{t('Restore default prompt')}</button></div>
      <textarea id="classification-prompt" className="classification-prompt" rows={18} spellCheck={false} value={values.classificationPrompt} onChange={(event) => config.update({ classificationPrompt: event.target.value })} />
      <p className="muted small">{t('Transaction JSON is appended automatically. Saving applies to future classification tasks; use Reclassify to update existing results. Manual categories, countries and splits are preserved.')}</p>
    </>}
    {section === 'advanced' && <div className="configuration-grid">
      <label>{t('Codex CLI executable')}<input value={values.codexBin} onChange={(event) => config.update({ codexBin: event.target.value })} /></label>
      <label>{t('Codex timeout (seconds)')}<input type="number" min="1" max="600" value={values.codexTimeoutMs / 1000} onChange={(event) => config.update({ codexTimeoutMs: Number(event.target.value) * 1000 })} /></label>
      <label>{t('Claude Code CLI executable')}<input value={values.claudeBin ?? 'claude'} onChange={(event) => config.update({ claudeBin: event.target.value })} /></label>
      <label>{t('Claude Code timeout (seconds)')}<input type="number" min="1" max="600" value={(values.claudeTimeoutMs ?? 120000) / 1000} onChange={(event) => config.update({ claudeTimeoutMs: Number(event.target.value) * 1000 })} /></label>
      <label>{t('Server port')}<input type="number" min="1" max="65535" value={values.port} onChange={(event) => config.update({ port: Number(event.target.value) })} /><small className="muted">{t('Changing the port requires an application restart.')}</small></label>
    </div>}
    <div className="configuration-actions"><button className="button primary" disabled={!config.draft || config.saving || busy} onClick={() => void config.save()}>{config.saving ? t('Saving…') : t('Save settings')}</button>
      {config.draft && <span className="muted small">{t('Saves all unsaved configuration changes on this page.')}</span>}
    </div>{busy && <p className="muted small">{t('Wait for the current synchronization or classification task to finish before saving settings.')}</p>}
  </fieldset>;
}
