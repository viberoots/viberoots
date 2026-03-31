#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";

async function main(): Promise<void> {
  const attr = getFlagStr("attr", "");
  if (!attr) {
    console.error("[nix-build-filtered-flake] missing --attr");
    process.exit(2);
  }
  const root = path.resolve(String(process.env.WORKSPACE_ROOT || process.cwd()).trim());
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "bnx-flake-"));
  const snapDir = path.join(workDir, "src");
  const withHeartbeat = async <T>(label: string, p: Promise<T>): Promise<T> => {
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      console.error(`[nix-build-filtered-flake] ${label} still running (${elapsed}s)`);
    }, 15000);
    try {
      return await p;
    } finally {
      clearInterval(timer);
    }
  };
  try {
    await fsp.mkdir(snapDir, { recursive: true });
    console.error("[nix-build-filtered-flake] creating filtered snapshot:", snapDir);
    await withHeartbeat(
      "snapshot-rsync",
      $({
        stdio: "inherit",
      })`rsync -a --delete --exclude .git --exclude node_modules --exclude buck-out --exclude .direnv --exclude .pnpm-store --exclude .pnpm-home --exclude coverage --exclude .clinic --exclude .turbo --exclude .cache --exclude dist --exclude build --exclude .vite --exclude .next --exclude .wasm-producer --exclude pnpm-workspace.yaml --exclude .node_modules.lockfile-guard.* --exclude result --exclude result-* ${root}/ ${snapDir}/`,
    );
    const flakeRef = `path:${snapDir}#${attr}`;
    console.error("[nix-build-filtered-flake] building attr:", attr);
    const res = await withHeartbeat(
      "nix-build",
      $({
        stdio: "pipe",
      })`nix build --impure ${flakeRef} --accept-flake-config --option min-free 0 --option max-free 0 --no-link --print-out-paths`,
    );
    process.stdout.write(String(res.stdout || ""));
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
