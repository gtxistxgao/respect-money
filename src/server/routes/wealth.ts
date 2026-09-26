import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { message as t } from '../../i18n/index.js';
import { dateSchema } from '../../shared/models.js';
import { assetInput, emptyWealth, type AssetInput } from '../../shared/wealth.js';
import { AppError } from '../domain/ledger.js';
import type { WealthService } from '../services/wealth.js';
import type { Repository, RepositoryState } from '../storage/repository.js';

function checkDebtLink(state: RepositoryState, asset: AssetInput, id?: string) {
  if (!asset.debtAccountId) return;
  const wealth = state.wealth || emptyWealth();
  const account = state.accounts.find((account) => account.id === asset.debtAccountId && account.source === 'plaid' && state.connections[account.itemId || '']);
  const balance = wealth.balances[asset.debtAccountId];
  if (!account || !balance?.debtAccount || balance.currency !== 'USD') throw new AppError(t('Choose an included USD debt account.'));
  if (wealth.assets.some((row) => row.id !== id && row.debtAccountId === asset.debtAccountId)) throw new AppError(t('This debt account is already linked to another asset.'));
}
export async function wealthRoutes(app: FastifyInstance, repository: Repository, service: WealthService) {
  app.get('/api/wealth', async () => service.summary());
  app.get('/api/wealth/history', async () => service.history());
  app.get('/api/wealth/history/:date', async (request) => service.historical(z.object({ date: dateSchema }).parse(request.params).date));
  app.post('/api/wealth/refresh', async (_request, reply) => reply.code(202).send(service.refresh()));
  app.post('/api/wealth/assets', async (request, reply) => {
    const input = assetInput.parse(request.body);
    const asset = { ...input, id: randomUUID(), revision: 0 };
    await repository.change((state) => {
      const wealth = state.wealth ||= emptyWealth();
      if (wealth.assets.length >= 1000) throw new AppError(t('The maximum is {p0}.', { p0: 1000 }));
      checkDebtLink(state, input); wealth.assets.push(asset);
    }, false);
    return reply.code(201).send(asset);
  });
  app.put('/api/wealth/assets/:id', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { revision, ...input } = assetInput.safeExtend({ revision: z.number().int().nonnegative() }).parse(request.body);
    return repository.change((state) => {
      const asset = state.wealth?.assets.find((row) => row.id === id);
      if (!asset) throw new AppError(t('Asset not found.'), 404);
      if (asset.revision !== revision) throw new AppError(t('This asset changed in another window. Reload before saving.'), 409);
      checkDebtLink(state, input, id); Object.assign(asset, input, { revision: revision + 1 }); return asset;
    }, false);
  });
  app.delete('/api/wealth/assets/:id', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(request.body);
    await repository.change((state) => {
      const asset = state.wealth?.assets.find((row) => row.id === id);
      if (!asset) throw new AppError(t('Asset not found.'), 404);
      if (asset.revision !== revision) throw new AppError(t('This asset changed in another window. Reload before saving.'), 409);
      state.wealth!.assets = state.wealth!.assets.filter((row) => row.id !== id);
    }, false);
    return { ok: true };
  });
}
