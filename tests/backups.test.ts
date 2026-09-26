import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repository } from '../src/server/storage/repository.js';
import { createBackup, restoreBackup } from '../src/server/storage/backups.js';

it('backs up and restores the ledger with checksums and a copy of the pre-restore state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'respect-money-backup-'));
  let repository = await new Repository(root).initialize();
  try {
    const account = await repository.addAccount({ name: 'Fictional', institution: 'Test', mask: '0000', type: 'cash' });
    await repository.addManual({ accountId: account.id, postedDate: '2026-08-01', description: 'Test', amount: '12.34', kind: 'expense', category: 'dining', country: 'US', notes: '' });
    await expect(createBackup(root)).rejects.toThrow("Another application instance");
    await repository.close();
    const backup = await createBackup(root);
    repository = await new Repository(root).initialize();
    await repository.addManual({ accountId: account.id, postedDate: '2026-08-02', description: 'Later', amount: '56.78', kind: 'expense', category: 'shopping', country: 'US', notes: '' });
    await repository.close();
    const previous = await restoreBackup(root, backup);
    expect(previous).not.toBeNull();
    expect(await readFile(join(previous!, 'manifest.json'), 'utf8')).toContain('respect-money.sqlite');
    repository = await new Repository(root).initialize();
    expect(repository.snapshot().processed).toHaveLength(1);
    await repository.close();
    await writeFile(join(backup, 'respect-money.sqlite'), '{}');
    await expect(restoreBackup(root, backup)).rejects.toThrow("verification failed");
  } finally { await repository.close(); await rm(root, { recursive: true, force: true }); }
});
