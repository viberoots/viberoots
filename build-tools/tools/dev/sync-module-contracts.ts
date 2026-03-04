#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import { syncModuleContractsForApp } from "./sync-module-contracts-core.ts";

async function main() {
  const appCwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const appTargetLabel = getFlagStr("app-target", "");
  try {
    const paths = await syncModuleContractsForApp({
      appCwd,
      appTargetLabel: appTargetLabel || undefined,
    });
    console.error(
      `[module-contracts] sync:ok app_target=${paths.appTargetLabel} app_id=${paths.appId} out=${paths.contractsDir}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[module-contracts] sync:fail");
    console.error(msg);
    console.error(
      "[module-contracts] recovery: fix TARGETS/package.json contract inputs, then rerun `pnpm run dev:wasm:watch`",
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
