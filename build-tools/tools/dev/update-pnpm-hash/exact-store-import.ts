import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runManagedCommand } from "../../lib/managed-command";
import { newManagedCommandActivity } from "./activity";
import { runExactStoreCommand } from "./exact-store-command";
import { withHeartbeat } from "./heartbeat";

async function createExactStoreArchive(opts: {
  repoRoot: string;
  importer: string;
  storeDir: string;
  timeoutMs: number;
}): Promise<string> {
  const archiveDir = path.join(path.dirname(opts.storeDir), "archive");
  const archivePath = path.join(archiveDir, "store.tar");
  await fsp.rm(archiveDir, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(archiveDir, { recursive: true });
  const activity = newManagedCommandActivity();
  const result = await withHeartbeat(
    `importer=${opts.importer} step=exact-store-archive`,
    runManagedCommand({
      command: "tar",
      args: ["-cf", archivePath, "-C", opts.storeDir, "."],
      cwd: opts.repoRoot,
      env: process.env,
      timeoutMs: opts.timeoutMs,
      activity,
    }),
    { activity, noOutputWarnSec: 60 },
  );
  if (result.ok) return archiveDir;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const reason = result.timedOut
    ? `timed out after ${Math.max(1, Math.ceil(opts.timeoutMs / 1000))}s`
    : `failed (code=${String(result.code)} signal=${String(result.signal)})`;
  const output = `${stdout}${stderr}`.trim();
  throw new Error(
    output
      ? `[update-pnpm-hash] importer=${opts.importer} step=exact-store-archive ${reason}\n${output}`
      : `[update-pnpm-hash] importer=${opts.importer} step=exact-store-archive ${reason}`,
  );
}

export async function importExactStoreIntoNixStore(opts: {
  repoRoot: string;
  importer: string;
  storeDir: string;
  timeoutMs: number;
}): Promise<string> {
  const safeName = opts.importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-") || "root";
  const archiveDir = await createExactStoreArchive(opts);
  try {
    const added = await runExactStoreCommand({
      label: `importer=${opts.importer} step=exact-store-import`,
      cwd: opts.repoRoot,
      timeoutMs: opts.timeoutMs,
      env: {
        ...process.env,
      },
      args: ["store", "add-path", "--name", `pnpm-exact-store-${safeName}`, archiveDir],
    });
    const nixStorePath =
      String(added.stdout || "")
        .trim()
        .split(/\s+/)
        .pop() || "";
    if (!nixStorePath.startsWith("/nix/store/")) {
      const output = `${added.stdout}${added.stderr}`.trim();
      throw new Error(
        output
          ? `failed to import exact pnpm store into nix store for ${opts.importer}\n${output}`
          : `failed to import exact pnpm store into nix store for ${opts.importer}`,
      );
    }
    return nixStorePath;
  } finally {
    await fsp.rm(archiveDir, { recursive: true, force: true }).catch(() => {});
  }
}
