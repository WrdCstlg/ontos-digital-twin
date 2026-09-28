/**
 * An open-ontologies engine of a test's own: in memory, on a free port, with a
 * temporary data directory, so it shares nothing with the engine other test
 * files use on 8085, nor with the user's ~/.open-ontologies. Needs the binary:
 * OPEN_ONTOLOGIES_BIN, or bin/ beside app/ or in it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type PrivateEngine = { url: string; stop: () => Promise<void> };

function engineBinary(): string {
  const candidates = [
    process.env.OPEN_ONTOLOGIES_BIN,
    ...["bin", path.join("..", "bin")].flatMap((dir) => ["open-ontologies.exe", "open-ontologies"].map((f) => path.resolve(process.cwd(), dir, f))),
  ];
  const found = candidates.find((c): c is string => !!c && fs.existsSync(c));
  if (!found) throw new Error("No open-ontologies binary: set OPEN_ONTOLOGIES_BIN");
  return found;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export async function startPrivateEngine(): Promise<PrivateEngine> {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ontos-engine-test-"));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: dataDir, USERPROFILE: dataDir };
  delete env.OPEN_ONTOLOGIES_STORAGE_MODE;
  delete env.OPEN_ONTOLOGIES_TOKEN;
  const child: ChildProcess = spawn(
    engineBinary(),
    ["--data-dir", dataDir, "serve-http", "--config", path.join(dataDir, "config.toml"), "--host", "127.0.0.1", "--port", String(port)],
    { env, stdio: "ignore", windowsHide: true },
  );
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    }
    // Windows keeps the files locked for a moment after the process ends.
    for (let i = 0; i < 20; i++) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    const up = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) }).then((r) => r.ok, () => false);
    if (up) return { url, stop };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stop();
  throw new Error(`The test engine did not come up on ${url}`);
}
