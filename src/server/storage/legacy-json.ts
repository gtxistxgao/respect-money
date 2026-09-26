import { message as t } from "../../i18n/index.js";
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { classificationSchema, ledgerRowSchema, monthSchema, overrideSchema, type RawRecord } from '../../shared/models.js';
import { AppError, normalize } from '../domain/ledger.js';
import { emptyState, metadataSchema, vaultSchema } from './state.js';
import { validateState } from './state-validation.js';

export const legacyDirectories = ['raw', 'processed', 'manual', 'overrides', 'meta', 'private'];
export const fileDigest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function legacyDocuments(root: string) {
  const docs: Record<string, string> = {};
  for (const directory of legacyDirectories) {
    let names: string[];
    try { names = await readdir(join(root, directory)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names.sort()) if (name.endsWith('.json')) docs[`${directory}/${name}`] = await readFile(join(root, directory, name), 'utf8');
  }
  return docs;
}
export async function hasLegacyData(root: string) {
  for (const directory of legacyDirectories) {
    try { if ((await readdir(join(root, directory))).some((file) => file.endsWith('.json'))) return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return false;
}

export function decodeLegacy(docs: Record<string, string>) {
  const state = emptyState();
  const read = (file: string): unknown => {
    try { return JSON.parse(docs[file]) as unknown; }
    catch { throw new AppError(t("Could not read {p0}. Check the file or restore from a backup.", { p0: file }), 503); }
  };
  if (!docs['meta/state.json']) throw new AppError(t("Legacy data is missing account and source mappings. Migration was not performed."), 503);
  const meta = read('meta/state.json'); metadataSchema.parse(meta); Object.assign(state, meta);
  if (docs['private/plaid.json']) { const vault = read('private/plaid.json'); vaultSchema.parse(vault); state.vault = vault as typeof state.vault; }
  if (docs['meta/classifications.json']) {
    const classifications = read('meta/classifications.json'); z.record(z.string(), classificationSchema).parse(classifications);
    state.classifications = classifications as typeof state.classifications;
  }
  const recognized = new Set(['meta/state.json', 'meta/classifications.json', 'private/plaid.json']);
  for (const [file] of Object.entries(docs)) {
    if (/^(raw|manual)\//.test(file)) {
      const doc = read(file) as { schemaVersion: number; month: string; accountId: string; source: RawRecord['source']; transactions: RawRecord['payload'][] };
      z.object({ schemaVersion: z.literal(1), month: monthSchema, accountId: z.string(), source: z.enum(['manual', 'plaid_transactions', 'plaid_investments']), transactions: z.array(z.record(z.string(), z.unknown())) }).strict().parse(doc);
      for (const payload of doc.transactions) {
        const record: RawRecord = { accountId: doc.accountId, source: doc.source, payload };
        const tx = normalize(record);
        if (!tx.postedDate.startsWith(doc.month)) throw new AppError(t("Dates in monthly file {p0} do not match its month.", { p0: file }), 503);
        if (state.records[tx.id]) throw new AppError(t("The data directory contains duplicate source transactions."), 503);
        state.records[tx.id] = record;
      }
      recognized.add(file);
    } else if (file.startsWith('overrides/')) {
      const doc = read(file) as { changes: typeof state.overrides };
      z.object({ schemaVersion: z.literal(1), changes: z.record(z.string(), overrideSchema) }).strict().parse(doc);
      for (const [id, value] of Object.entries(doc.changes)) {
        if (state.overrides[id] && JSON.stringify(state.overrides[id]) !== JSON.stringify(value)) throw new AppError(t("Manual overrides contain conflicting duplicates. Migration was not performed."), 503);
        state.overrides[id] = value;
      }
      recognized.add(file);
    } else if (file.startsWith('processed/')) {
      const doc = read(file) as { accountId: string; month: string; transactions: typeof state.processed };
      z.object({ schemaVersion: z.literal(1), accountId: z.string(), month: monthSchema, transactions: z.array(ledgerRowSchema) }).strict().parse(doc);
      if (doc.transactions.some((row) => row.accountId !== doc.accountId || !row.postedDate.startsWith(doc.month))) throw new AppError(t("The account or month in processed file {p0} does not match its records.", { p0: file }), 503);
      state.processed.push(...doc.transactions); recognized.add(file);
    }
  }
  if (Object.keys(docs).some((file) => !recognized.has(file))) throw new AppError(t("Legacy directories contain unrecognized JSON files. Migration was not performed."), 503);
  validateState(state);
  return state;
}

export async function legacySnapshot(root: string, docs: Record<string, string>, prefix = 'before-sqlite-') {
  const createdAt = new Date().toISOString();
  const path = join(root, 'backups', `${prefix}${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(path, { recursive: true, mode: 0o700 });
  for (const [file, contents] of Object.entries(docs)) {
    await mkdir(dirname(join(path, file)), { recursive: true, mode: 0o700 });
    await writeFile(join(path, file), contents, { flag: 'wx', mode: 0o600, flush: true });
  }
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ version: 1, createdAt, files: Object.fromEntries(Object.entries(docs).map(([file, value]) => [file, fileDigest(value)])) }, null, 2), { flag: 'wx', mode: 0o600, flush: true });
  return path;
}
