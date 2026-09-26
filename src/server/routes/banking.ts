import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { linkCompletionSchema } from '../../shared/banking.js';
import { rangeSchema } from '../../shared/models.js';
import type { Connections } from '../services/connections.js';
import type { Jobs } from '../services/jobs.js';
import type { Repository } from '../storage/repository.js';

export async function bankingRoutes(app: FastifyInstance, connections: Connections, jobs: Jobs, repository: Repository) {
  app.delete('/api/plaid/connections/:id', async (request) => connections.disconnect(z.object({ id: z.string().min(1) }).parse(request.params).id));
  app.post('/api/plaid/link-token', async (request) => {
    const value = z.object({ product: z.enum(['transactions', 'investments']).optional(), connectionId: z.string().optional() }).parse(request.body);
    return connections.createLink(value.connectionId);
  });
  app.post('/api/plaid/complete', async (request) => {
    const value = linkCompletionSchema.parse(request.body);
    return connections.completeLink(value);
  });
  app.post('/api/jobs', async (request, reply) => {
    const value = z.object({ type: z.enum(['sync', 'classify']).default('sync'), range: rangeSchema, accountIds: z.array(z.string()).max(100).optional(), force: z.boolean().optional(), refresh: z.boolean().optional() }).parse(request.body);
    return reply.code(202).send(await jobs.enqueue(value));
  });
  app.post('/api/jobs/:id/retry', async (request, reply) => reply.code(202).send(await jobs.retry((request.params as { id: string }).id)));
  app.get('/api/jobs', async () => Object.values(repository.snapshot().jobs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50));
}
