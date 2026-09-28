import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { categoryDefinitionSchema, categoryDefinitionsSchema, resolveCategories } from '../../shared/categories.js';
import { canonicalCategory } from '../../shared/models.js';
import { message as t } from '../../i18n/index.js';
import { AppError, normalize } from '../domain/ledger.js';
import { applyCategoryPolicy } from '../domain/category-policy.js';
import type { AppConfig } from '../config.js';
import type { Repository, RepositoryState } from '../storage/repository.js';

const input = categoryDefinitionSchema.omit({ id: true }).extend({ revision: z.number().int().nonnegative() });
export async function categoryRoutes(app: FastifyInstance, repository: Repository, config: AppConfig) {
  const current = () => { const state = repository.snapshot(); return { revision: state.settings!.revision, categories: resolveCategories(state.settings) }; };
  const change = async (revision: number, edit: (state: RepositoryState) => void) => {
    const settings = await repository.change(state => {
      if (state.settings!.revision !== revision) throw new AppError(t('Settings changed in another window. Reload settings before saving.'), 409);
      if (Object.values(state.jobs).some(job => ['queued', 'fetching', 'classifying', 'publishing'].includes(job.status))) throw new AppError(t('Wait for the current synchronization or classification task to finish before saving settings.'), 409);
      state.settings!.categoryDefinitions = structuredClone(resolveCategories(state.settings));
      edit(state);
      state.settings!.categoryDefinitions = categoryDefinitionsSchema.parse(state.settings!.categoryDefinitions);
      state.settings!.revision++;
      // Reproject the published snapshot, including stale accounts, without
      // publishing partially completed classifications or changing bank facts.
      state.processed = state.processed.map(row => applyCategoryPolicy(row, state.settings));
      return state.settings!;
    }, false);
    Object.assign(config, settings);
    return current();
  };
  app.get('/api/categories', async () => current());
  app.post('/api/categories', async (request, reply) => {
    const { revision, ...value } = input.parse(request.body);
    const result = await change(revision, state => { state.settings!.categoryDefinitions!.push({ ...value, id: 'custom_' + randomUUID().replaceAll('-', '') }); });
    return reply.code(201).send(result);
  });
  app.put('/api/categories/:id', async request => {
    const { id } = request.params as { id: string };
    const { revision, ...value } = input.parse(request.body);
    return change(revision, state => {
      const category = state.settings!.categoryDefinitions!.find(row => row.id === id);
      if (!category) throw new AppError(t('Category not found. Refresh categories and retry.'), 404);
      Object.assign(category, value);
    });
  });
  app.delete('/api/categories/:id', async request => {
    const { id } = request.params as { id: string };
    const { revision, replacement } = z.strictObject({ revision: z.number().int().nonnegative(), replacement: z.string() }).parse(request.body);
    return change(revision, state => {
      const definitions = state.settings!.categoryDefinitions!;
      if (id === 'uncategorized' || id === replacement || !definitions.some(row => row.id === id) || !definitions.some(row => row.id === replacement)) throw new AppError(t('Choose a different existing category. Uncategorized cannot be deleted.'), 400);
      state.settings!.categoryDefinitions = definitions.filter(row => row.id !== id);
      const redirects = state.settings!.categoryRedirects ??= {};
      for (const [key, value] of Object.entries(redirects)) if (value === id) redirects[key] = replacement;
      redirects[id] = replacement;
      for (const [key, record] of Object.entries(state.records)) {
        const previous = state.overrides[key];
        const source = normalize(record);
        const override = previous ? structuredClone(previous) : undefined;
        const affected = canonicalCategory(source.category) === id || canonicalCategory(previous?.category) === id || previous?.splits?.some(split => canonicalCategory(split.category) === id);
        if (!affected) continue;
        const next = override ?? { revision: 0, updatedAt: '' };
        if (canonicalCategory(next.category ?? source.category) === id) next.category = replacement;
        next.splits?.forEach(split => { if (canonicalCategory(split.category) === id) split.category = replacement; });
        next.revision++; next.updatedAt = new Date().toISOString(); state.overrides[key] = next;
        for (const row of state.processed) if (row.parentId === key) row.version = `${row.sourceHash}:${next.revision}`;
      }
      for (const row of Object.values(state.classifications)) if (canonicalCategory(row.category) === id) row.category = replacement;
      for (const row of state.processed) if (canonicalCategory(row.category) === id) row.category = replacement;
      for (const rule of state.reclassificationRules ?? []) if (canonicalCategory(rule.category) === id) { rule.category = replacement; rule.revision++; }
    });
  });
}
