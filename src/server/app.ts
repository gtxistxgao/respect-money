import { WealthService } from './services/wealth.js';
import { wealthRoutes } from './routes/wealth.js';
import { classificationBackend } from './integrations/ai.js';
import { categoryRoutes } from './routes/categories.js';
import { settingsRoutes } from './routes/settings.js';
import { applicationSettingsSchema, type ModelOption } from '../shared/settings.js';
import { localizeResponse, validationMessage, validationPath } from './localization.js';
import { message as t, resolveLocale, renderMessage } from "../i18n/index.js";
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readConfig, type AppConfig } from './config.js';
import { Repository } from './storage/repository.js';
import { accountingRoutes } from './routes/accounting.js';
import { ZodError } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPlaidGateway, type PlaidGateway } from './integrations/plaid/client.js';
import { Connections } from './services/connections.js';
import { Jobs } from './services/jobs.js';
import { bankingRoutes } from './routes/banking.js';
import { AppError } from './domain/ledger.js';
import { ClassificationService } from './services/classification.js';
import { classificationPrompt, type ClassifyBatch } from './integrations/codex/classifier.js';
import { type MatchPatterns } from './integrations/codex/pattern-matcher.js';
import { ReclassificationService } from './services/reclassification.js';
import { reclassificationRoutes } from './routes/reclassification.js';

export async function buildApp(config: AppConfig = readConfig(), dependencies: { plaid?: PlaidGateway; polling?: { attempts: number; delayMs: number }; classifyBatch?: ClassifyBatch; matchPatterns?: MatchPatterns; models?: (bin: string) => Promise<ModelOption[]> } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.addHook('preSerialization', async (request, reply, payload) => {
    const locale = resolveLocale(request.headers['accept-language']);
    reply.header('Content-Language', locale).header('Vary', 'Accept-Language');
    return localizeResponse(payload, locale);
  });
  const repository = await new Repository(config.dataDir).initialize();
  config = { ...config, ...repository.snapshot().settings };
  if (!repository.snapshot().settings) await repository.change((state) => {
    const { dataDir: _dataDir, ...settings } = config; void _dataDir;
    state.settings = applicationSettingsSchema.parse(settings);
  }, false);
  // Resolve a gateway from the saved configuration for each operation. Saving is
  // refused while bank/classification jobs are active, so a job uses one configuration.
  const plaid = dependencies.plaid || new Proxy({} as PlaidGateway, {
    get: (_target, key: keyof PlaidGateway) => createPlaidGateway(config)[key],
  });
  const connections = new Connections(repository, plaid, config);
  await connections.recheckConsentErrors();
  const jobs = new Jobs(repository, plaid, dependencies.polling);
  let versionCache: { key: string; value: string | null } | undefined;
  const version = async () => {
    const backend = classificationBackend(config);
    const { bin } = backend;
    const key = `${backend.provider}/${bin}`;
    if (versionCache?.key === key) return versionCache.value;
    let value: string | null = null;
    try { value = (await promisify(execFile)(bin, ['--version'], { timeout: 3000, maxBuffer: 4096, env: backend.environment() })).stdout.trim().slice(0, 200); }
    catch { /* Manual accounting remains available without the CLI. */ }
    versionCache = { key, value }; return value;
  };
  await version();
  jobs.setPublisher(async (...args) => {
    const backend = classificationBackend(config);
    const fingerprint = `${backend.provider}/${await version() || 'unavailable'}/${backend.model || 'cli-default'}`;
    return new ClassificationService(repository,
      dependencies.classifyBatch || backend.classify,
      config.classificationPrompt === classificationPrompt ? fingerprint : JSON.stringify([fingerprint, config.classificationPrompt]), backend.provider,
    ).publish(...args);
  });
  const reclassification = new ReclassificationService(repository, () => dependencies.matchPatterns || classificationBackend(config).matchPatterns);
  const wealth = new WealthService(repository, plaid);
  app.addHook('onClose', async () => { await wealth.close(); await jobs.close(); await reclassification.close(); await repository.close(); });
  const runningPort = config.port;
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  app.addHook('onRequest', async (request, reply) => {
    const host = new URL(`http://${request.headers.host || 'localhost'}`).hostname;
    if (!allowedHosts.has(host)) return reply.code(403).send({ error: t("Only local access is allowed.") });
    const origin = request.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        if (!allowedHosts.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || ![String(runningPort), '5173'].includes(url.port)) {
          return reply.code(403).send({ error: t("This request origin is not allowed.") });
        }
      } catch { return reply.code(403).send({ error: t("Invalid request origin.") }); }
    }
  });
  app.get('/api/health', async () => ({ ok: true, name: 'Respect Money' }));
  app.get('/api/settings/status', async () => {
    const state = repository.snapshot();
    return { plaidConfigured: Boolean(config.plaidClientId && config.plaidSecret), plaidEnv: config.plaidEnv, classificationProvider: config.classificationProvider ?? 'codex', cliVersion: await version(), codexVersion: (config.classificationProvider ?? 'codex') === 'codex' ? await version() : null,
      connections: Object.values(state.connections).map(({ cursor: _cursor, ...connection }) => { void _cursor; return connection; }), jobs: Object.values(state.jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20), staleAccountIds: state.staleAccountIds };
  });
  await settingsRoutes(app, repository, config, dependencies.models);
  await accountingRoutes(app, repository);
  await categoryRoutes(app, repository, config);
  await wealthRoutes(app, repository, wealth);
  await reclassificationRoutes(app, repository, reclassification);
  await bankingRoutes(app, connections, jobs, repository);
  app.setErrorHandler((error, request, reply) => {
    const locale = resolveLocale(request.headers['accept-language']);
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues.map((issue) => `${validationPath(issue, locale)}: ${validationMessage(issue, locale)}`).join('; ') });
    const detail = error as { statusCode?: number; message?: string };
    const status = typeof detail.statusCode === 'number' ? detail.statusCode : 500;
    reply.code(status).send({ error: error instanceof AppError ? renderMessage(error.localizedMessage, locale) : status < 500 ? renderMessage(t('Invalid value.'), locale) : t("The operation could not be completed. Please try again.") });
  });
  const webDir = resolve('dist/web');
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: t("API endpoint not found.") });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
