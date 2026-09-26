import { message as t } from "../../i18n/index.js";
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../domain/ledger.js';
import { WriterLock } from './writer-lock.js';

type Manifest = { version: 1; writes: Record<string, string | null> };

export class AtomicFiles {
  private locked = false;
  private readonly lock: WriterLock;
  constructor(readonly root: string, private readonly afterWrite?: (index: number) => void) { this.lock = new WriterLock(root); }
  private path(file: string) {
    const path = resolve(this.root, file);
    if (!relative(this.root, path) || relative(this.root, path).startsWith('..')) throw new AppError(t("Invalid file path."));
    return path;
  }
  async initialize() {
    await this.lock.acquire();
    this.locked = true;
    try {
      await mkdir(join(this.root, '.staging'), { recursive: true, mode: 0o700 });
      await this.recover();
    } catch (error) { await this.close(); throw error; }
  }
  private async replace(target: string, contents: string) {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, target);
  }
  private async apply(manifest: Manifest, simulateFailure: boolean) {
    let index = 0;
    for (const [file, contents] of Object.entries(manifest.writes)) {
      const target = this.path(file);
      if (contents === null) await rm(target, { force: true });
      else await this.replace(target, contents);
      if (simulateFailure) this.afterWrite?.(++index);
    }
  }
  async write(writes: Record<string, string | null>) {
    if (!this.locked) throw new AppError(t("The data directory has not been initialized."), 503);
    if (!Object.keys(writes).length) return;
    const directory = join(this.root, '.staging', randomUUID());
    await mkdir(directory, { mode: 0o700 });
    const manifest: Manifest = { version: 1, writes };
    await this.replace(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await this.apply(manifest, true);
    await rm(directory, { recursive: true });
  }
  async recover() {
    const directory = join(this.root, '.staging');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const task = join(directory, entry.name);
      let manifest: Manifest;
      try { manifest = JSON.parse(await readFile(join(task, 'manifest.json'), 'utf8')) as Manifest; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await rm(task, { recursive: true }); continue; }
        throw new AppError(t("The write recovery journal is corrupt. Restore from a backup."), 503);
      }
      if (manifest?.version !== 1 || !manifest.writes || typeof manifest.writes !== 'object' || Array.isArray(manifest.writes) || Object.values(manifest.writes).some((value) => value !== null && typeof value !== 'string')) throw new AppError(t("Invalid recovery journal. Restore from a backup."), 503);
      for (const file of Object.keys(manifest.writes)) this.path(file);
      await this.apply(manifest, false);
      await rm(task, { recursive: true });
    }
  }
  async close() {
    if (this.locked) { this.locked = false; await this.lock.release(); }
  }
}
