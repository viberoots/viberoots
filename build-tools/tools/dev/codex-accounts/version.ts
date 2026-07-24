import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

type CacheRecord = { executable: string; mtimeMs: number; version: string; warned: boolean };

function versionCachePath(): string | null {
  const base =
    process.env.XDG_CACHE_HOME ||
    (process.env.HOME ? path.join(process.env.HOME, ".cache") : undefined);
  return base ? path.join(base, "codex-wrapper", "version.json") : null;
}

function compatible(version: string): boolean {
  return /\b0\.144\.\d+\b/.test(version);
}

export async function checkUpstreamVersion(realCodex: string): Promise<void> {
  if (!realCodex || process.env.VBR_CODEX_VERSION_CHECK === "off") return;
  const cachePath = versionCachePath();
  if (!cachePath) return;
  let mtimeMs: number;
  try {
    mtimeMs = (await fsp.stat(realCodex)).mtimeMs;
  } catch {
    return;
  }
  let cached: CacheRecord | null = null;
  try {
    cached = JSON.parse(await fsp.readFile(cachePath, "utf8")) as CacheRecord;
  } catch {}
  if (cached?.executable === realCodex && cached.mtimeMs === mtimeMs) return;

  const probe = spawnSync(realCodex, ["--version"], {
    encoding: "utf8",
    env: process.env,
    timeout: 10_000,
  });
  const version = String(probe.stdout || "").trim();
  const warned = probe.status !== 0 || !compatible(version);
  if (warned) {
    process.stderr.write(
      `warn: managed Codex version '${version || "unavailable"}' is outside the reviewed 0.144.x range\n` +
        "  review the wrapper account flag compatibility before relying on this version\n",
    );
  }
  await fsp.mkdir(path.dirname(cachePath), { recursive: true });
  const record: CacheRecord = { executable: realCodex, mtimeMs, version, warned };
  await fsp.writeFile(cachePath, JSON.stringify(record) + "\n", { mode: 0o600 });
}
