import { describe, expect, it } from 'vitest';
import { codexArguments, codexEnvironment } from '../src/server/integrations/codex/runner.js';

describe('classification process boundary', () => {
  it('omits application credentials and developer instructions', () => {
    process.env.PLAID_SECRET = 'fictional-secret';
    try {
      expect(codexEnvironment()).not.toHaveProperty('PLAID_SECRET');
      const args = codexArguments('/tmp/fictional-task', { bin: 'codex', timeoutMs: 1000 });
      expect(args).toContain('project_doc_max_bytes=0');
      expect(args).toContain('--ignore-user-config');
      expect(args).toContain('read-only');
      expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    } finally { delete process.env.PLAID_SECRET; }
  });
});
