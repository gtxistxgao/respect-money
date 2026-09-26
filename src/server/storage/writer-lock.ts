import { message as t } from "../../i18n/index.js";
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../domain/ledger.js';

// Shares the legacy lock format so the JSON writer and SQLite writer cannot overlap.
export class WriterLock {
  private held = false;
  constructor(readonly root: string) {}
  async acquire() {
    if (this.held) throw new AppError(t("The data directory lock is already held."), 503);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = join(this.root, '.writer-lock');
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let pid: number;
      try {
        pid = (JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')) as { pid: number }).pid;
        if (!Number.isInteger(pid) || pid <= 0) throw new AppError(t("The data directory lock contains an invalid process ID."), 503);
      } catch { throw new AppError(t("The data directory lock is incomplete. Confirm no other instance is running before removing .writer-lock."), 503); }
      try { process.kill(pid, 0); throw new AppError(t("Another application instance is using this data directory."), 503); }
      catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'ESRCH') throw reason;
        await rm(directory, { recursive: true });
        await mkdir(directory, { mode: 0o700 });
      }
    }
    this.held = true;
    try { await writeFile(join(directory, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600, flag: 'wx' }); }
    catch (error) { await this.release(); throw error; }
  }
  async release() {
    if (this.held) { this.held = false; await rm(join(this.root, '.writer-lock'), { recursive: true, force: true }); }
  }
}
