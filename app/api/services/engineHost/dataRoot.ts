import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The host's directory. Each workspace's store lives in `ws-<id>`, where the
 * engine keeps RocksDB (`triplestore/`) and its state database, and the host
 * keeps `host.json`, the store's incarnation. `.tmp` holds bodies on their way
 * to an engine; `.trash` holds stores being deleted.
 *
 * The host only works in a directory it made: a missing or empty one gets a
 * marker file, and one that holds anything else without the marker is refused.
 * A mistyped ENGINE_HOST_DATA_DIR must not make it adopt, or delete in,
 * someone else's directory.
 *
 * One host per data root is not enforced here yet: that takes a MySQL lock, in
 * a later PR. Until then RocksDB's LOCK is the safety net. A second host on the
 * same root cannot open a store the first holds, reports it `locked`, and
 * never resets or deletes it.
 */

export const ROOT_MARKER = ".ontos-engine-root";
const META_FILE = "host.json";
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type StoreMeta = {
  /** A random id, new with every reset. Writers name it, so none lands in a store rebuilt since. */
  incarnation: string;
  createdAt: string;
  /** The store's size when it last opened, plus loads since. */
  triples: number | null;
  /** Set after three failed opens in a row; only a reset clears it. */
  corrupt: { since: string; reason: string } | null;
};

export class DataRootError extends Error {}

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException)?.code;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (err) {
    if (errno(err) === "ENOENT") return false;
    throw err;
  }
}

/** fs.rename, retried while Windows still holds a file of an engine that just exited. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = errno(err);
      if (attempt >= 25 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export class DataRoot {
  private constructor(readonly dir: string) {}

  /** Opens (or makes) the data root, after checking it is one. */
  static async open(dir: string): Promise<DataRoot> {
    const root = path.resolve(dir);
    if (path.parse(root).root === root) throw new DataRootError(`Refusing a filesystem root as the data root: ${root}`);
    if (root === path.resolve(os.homedir())) throw new DataRootError(`Refusing the home directory as the data root: ${root}`);

    const marker = path.join(root, ROOT_MARKER);
    if (await exists(root)) {
      if (!(await fs.stat(root)).isDirectory()) throw new DataRootError(`The data root is not a directory: ${root}`);
      if (!(await exists(marker))) {
        const entries = (await fs.readdir(root)).filter((e) => e !== "lost+found");
        if (entries.length > 0) {
          throw new DataRootError(
            `Refusing to use ${root} as the data root: it holds files and no ${ROOT_MARKER} marker, so the host did not make it`,
          );
        }
      }
    } else {
      await fs.mkdir(root, { recursive: true });
    }
    if (!(await exists(marker))) {
      await fs.writeFile(marker, "An Ontos engine host keeps its workspace stores here.\n");
    }
    const dataRoot = new DataRoot(root);
    await fs.mkdir(dataRoot.tempDir, { recursive: true });
    await fs.mkdir(dataRoot.trashDir, { recursive: true });
    await dataRoot.sweep();
    return dataRoot;
  }

  get tempDir(): string {
    return path.join(this.dir, ".tmp");
  }

  get trashDir(): string {
    return path.join(this.dir, ".trash");
  }

  /** `ws-<id>`; the id is a positive safe integer, checked again here so no request can name a path. */
  storeDir(ws: number): string {
    if (!Number.isSafeInteger(ws) || ws <= 0) throw new Error(`Not a workspace id: ${ws}`);
    return path.join(this.dir, `ws-${ws}`);
  }

  /** A new path under .tmp (made again if something removed it), for a body on its way to an engine. */
  async tempFile(ext: string): Promise<string> {
    await fs.mkdir(this.tempDir, { recursive: true });
    return path.join(this.tempDir, `${randomUUID()}${ext}`);
  }

  async storeExists(ws: number): Promise<boolean> {
    return exists(this.storeDir(ws));
  }

  async readMeta(ws: number): Promise<StoreMeta | null> {
    let text: string;
    try {
      text = await fs.readFile(path.join(this.storeDir(ws), META_FILE), "utf8");
    } catch (err) {
      if (errno(err) === "ENOENT") return null;
      throw err;
    }
    try {
      const meta = JSON.parse(text) as Partial<StoreMeta>;
      if (typeof meta.incarnation !== "string" || !meta.incarnation) return null;
      return {
        incarnation: meta.incarnation,
        createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date(0).toISOString(),
        triples: typeof meta.triples === "number" ? meta.triples : null,
        corrupt: meta.corrupt && typeof meta.corrupt === "object" ? meta.corrupt : null,
      };
    } catch {
      // A torn or edited file: the store gets a new incarnation when it next opens,
      // which refuses writers that held the old one. That errs the safe way.
      return null;
    }
  }

  /** Written to a temporary file and renamed over the old one, so it is never half written. */
  async writeMeta(ws: number, meta: StoreMeta): Promise<void> {
    const dir = this.storeDir(ws);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${META_FILE}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`);
      await renameWithRetry(tmp, path.join(dir, META_FILE));
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Moves the store into .trash, then deletes it. The move is one step, so a
   * host that dies midway leaves either the whole store or none of it under
   * ws-<id>; whatever is left in .trash goes at the next start. The caller
   * makes sure no process has the store open.
   */
  async removeStore(ws: number): Promise<void> {
    const dir = this.storeDir(ws);
    const trash = path.join(this.trashDir, `ws-${ws}-${Date.now()}-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(this.trashDir, { recursive: true });
    try {
      await renameWithRetry(dir, trash);
    } catch (err) {
      if (errno(err) === "ENOENT") return;
      throw err;
    }
    await fs.rm(trash, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  /** Deletes a temporary file; one Windows still holds stays for the next sweep. */
  async removeTemp(file: string): Promise<void> {
    await fs.rm(file, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
  }

  /** Empties .trash, and deletes temporary files a host left behind (older than a day). */
  async sweep(now = Date.now()): Promise<void> {
    for (const entry of await fs.readdir(this.trashDir).catch(() => [] as string[])) {
      await fs
        .rm(path.join(this.trashDir, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        .catch(() => undefined);
    }
    for (const entry of await fs.readdir(this.tempDir).catch(() => [] as string[])) {
      const file = path.join(this.tempDir, entry);
      const stat = await fs.stat(file).catch(() => null);
      if (stat && now - stat.mtimeMs > TEMP_MAX_AGE_MS) await this.removeTemp(file);
    }
  }
}
