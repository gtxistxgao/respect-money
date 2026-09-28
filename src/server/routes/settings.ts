import { z } from 'zod';
import { defaultSettings } from '../config.js';
import { claudeModels } from '../integrations/ai.js';
import type { FastifyInstance } from 'fastify';
import { settingsUpdateSchema, defaultUsdCnyRate, type PublicSettings, type ModelOption } from '../../shared/settings.js';
import { message as t } from '../../i18n/index.js';
import type { Repository } from '../storage/repository.js';
import type { AppConfig } from '../config.js';
import { AppError } from '../domain/ledger.js';
import { classificationPrompt } from '../integrations/codex/classifier.js';
import { listCodexModels } from '../integrations/codex/models.js';

export async function settingsRoutes(app: FastifyInstance, repository: Repository, config: AppConfig, models = listCodexModels) {
  const runningPort = config.port;
  const publicSettings = (): PublicSettings => {
    const { plaidSecret, ...settings } = repository.snapshot().settings!;
    const { plaidSecret: _secret, ...defaults } = defaultSettings(); void _secret;
    return { ...defaults, ...settings, usdCnyRate: settings.usdCnyRate ?? defaultUsdCnyRate, hasPlaidSecret: Boolean(plaidSecret), defaultPrompt: classificationPrompt, runningPort };
  };
  let cached: { bin: string; expires: number; data: ModelOption[] } | undefined;
  let pending: { bin: string; promise: Promise<ModelOption[]> } | undefined;
  app.get('/api/settings', async () => publicSettings());
  app.get('/api/settings/models', async (request) => {
    const { provider = config.classificationProvider ?? 'codex' } = z.object({ provider: z.enum(['codex', 'claude']).optional() }).parse(request.query);
    if (provider === 'claude') return claudeModels;
    const bin = config.codexBin;
    try {
      if (cached?.bin === bin && cached.expires > Date.now()) return cached.data;
      const promise = pending?.bin === bin ? pending.promise : models(bin);
      pending = { bin, promise };
      const data = await promise;
      cached = { bin, data, expires: Date.now() + 60000 }; return data;
    } catch { throw new AppError(t('Could not load models. Check the Codex CLI path and sign-in, or enter a model ID manually.'), 503); }
    finally { if (pending?.bin === bin) pending = undefined; }
  });
  app.put('/api/settings', async (request) => {
    const { revision, clearPlaidSecret, ...patch } = settingsUpdateSchema.parse(request.body);
    const saved = await repository.change((state) => {
      const current = state.settings!;
      if (current.revision !== revision) throw new AppError(t('Settings changed in another window. Reload settings before saving.'), 409);
      if (Object.values(state.jobs).some((job) => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status))) throw new AppError(t('Wait for the current synchronization or classification task to finish before saving settings.'), 409);
      const next = { ...current, ...patch, plaidSecret: clearPlaidSecret ? '' : patch.plaidSecret || current.plaidSecret, revision: revision + 1 };
      const identityChanged = next.plaidEnv !== current.plaidEnv || next.plaidClientId !== current.plaidClientId;
      if (identityChanged && current.plaidClientId && (Object.keys(state.connections).length || Object.keys(state.vault.tokens).length)) throw new AppError(t('The Plaid environment and client ID are tied to existing bank connections and cannot be changed while accounts are connected.'), 409);
      if (identityChanged && Object.values(state.vault.links).some((link) => link.expiresAt > new Date().toISOString())) throw new AppError(t('Complete the bank authorization or wait for it to expire before changing the Plaid environment or client ID.'), 409);
      state.settings = next; return next;
    }, false);
    Object.assign(config, saved);
    return publicSettings();
  });
}
