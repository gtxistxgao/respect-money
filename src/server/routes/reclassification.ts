import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reclassificationRuleInput } from '../../shared/reclassification.js';
import type { Repository } from '../storage/repository.js';
import type { ReclassificationService } from '../services/reclassification.js';

export async function reclassificationRoutes(app: FastifyInstance, repository: Repository, service: ReclassificationService) {
  const id = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  app.get('/api/reclassification/rules', async () => repository.snapshot().reclassificationRules || []);
  app.post('/api/reclassification/rules', async (request, reply) => reply.code(201).send(await service.save(reclassificationRuleInput.parse(request.body))));
  app.put('/api/reclassification/rules/:id', async (request) => {
    const { revision, ...rule } = reclassificationRuleInput.extend({ revision: z.number().int().positive() }).parse(request.body);
    return service.save(rule, id(request.params), revision);
  });
  app.delete('/api/reclassification/rules/:id', async (request) => {
    const { revision } = z.strictObject({ revision: z.number().int().positive() }).parse(request.body);
    await service.remove(id(request.params), revision); return { ok: true };
  });
  app.post('/api/reclassification/rules/:id/preview', async (request, reply) => reply.code(202).send(service.start(id(request.params))));
  app.get('/api/reclassification/previews/latest', async () => service.latest());
  app.get('/api/reclassification/previews/:id', async (request) => service.get(id(request.params)));
  app.post('/api/reclassification/previews/:id/apply', async (request) => {
    const { transactionIds } = z.strictObject({ transactionIds: z.array(z.string().min(1)).min(1).max(20000) }).parse(request.body);
    return service.apply(id(request.params), transactionIds);
  });
}
