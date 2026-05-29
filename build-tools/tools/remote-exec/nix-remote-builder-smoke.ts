#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { buildSmokeReport, remoteCiToolsPathEnv } from "./nix-remote-builder-config";

async function main() {
  process.env = remoteCiToolsPathEnv(
    getFlagStr("remote-ci-tools", process.env.VBR_REMOTE_CI_TOOLS || ""),
  );
  const builderUri = getFlagStr("builder-uri");
  const buildersFile = getFlagStr("builders-file");
  const probeBuild = getFlagBool("probe-build");
  const allowDisabled = getFlagBool("allow-disabled");
  const reportPath = getFlagStr("report", "");
  const nixConfigText = await readEffectiveConfig();
  const envrcText = await fs.readFile(".envrc", "utf8").catch(() => "");
  const report = buildSmokeReport({
    nixConfigText,
    envrcText,
    builderUri,
    buildersFile,
    probeBuild,
  });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) await fs.writeFile(reportPath, text, { mode: 0o600 });
  else process.stdout.write(text);
  if (!report.ok && !allowDisabled) {
    for (const diagnostic of report.diagnostics) console.error(diagnostic);
    process.exit(1);
  }
  for (const command of report.commands) await $`${command}`;
}

async function readEffectiveConfig(): Promise<string> {
  const res = await $`nix show-config`.nothrow();
  return String(res.stdout || process.env.NIX_CONFIG || "");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
