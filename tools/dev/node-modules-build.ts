#!/usr/bin/env node
import path from "node:path";
import { withExclusiveInstallLock } from "./install/lock.ts";

type Args = {
  [key: string]: any;
  "print-out-paths"?: boolean;
};

function repoRoot(): string {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return path.resolve(here, "..", "..");
  } catch {
    return process.cwd();
  }
}

async function main() {
  const printOut =
    process.argv.includes("--print-out-paths") || !process.argv.includes("--no-print-out-paths");
  const root = repoRoot();
  const nodeModulesLabel = ".#node-modules";
  const cmd = ["nix", "build", nodeModulesLabel, "--no-link", "--accept-flake-config"];
  if (printOut) cmd.push("--print-out-paths");

  let out = "";
  await withExclusiveInstallLock(
    "node-modules",
    async () => {
      const cp = await import("node:child_process");
      const res = cp.spawnSync(cmd[0] as string, cmd.slice(1) as string[], {
        cwd: root,
        stdio: printOut ? ["ignore", "pipe", "inherit"] : "inherit",
        env: process.env,
      });
      if (res.status && res.status !== 0) {
        process.exit(res.status);
      }
      out = printOut ? String(res.stdout?.toString() || "").trim() : "";
    },
    { verbose: false },
  );

  if (printOut) {
    console.log(out);
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
