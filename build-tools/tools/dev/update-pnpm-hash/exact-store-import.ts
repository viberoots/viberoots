import * as fsp from "node:fs/promises";
import process from "node:process";
import { runExactStoreCommand } from "./exact-store-command";

export async function importExactStoreIntoNixStore(opts: {
  repoRoot: string;
  importer: string;
  storeDir: string;
  timeoutMs: number;
}): Promise<string> {
  const safeName = opts.importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-") || "root";
  try {
    const added = await runExactStoreCommand({
      label: `importer=${opts.importer} step=exact-store-import`,
      cwd: opts.repoRoot,
      timeoutMs: opts.timeoutMs,
      env: {
        ...process.env,
      },
      args: ["store", "add-path", "--name", `pnpm-exact-store-${safeName}`, opts.storeDir],
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
    await fsp.rm(opts.storeDir, { recursive: true, force: true }).catch(() => {});
  }
}
