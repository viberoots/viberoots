#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import { candidatePolicyFiles, dormantSurfaces } from "./default-local-policy-files";
import type { PolicyReport } from "./default-local-policy-model";
import {
  checkBuckconfig,
  checkCiRemoteEnvDefaults,
  checkConfigSecrets,
  checkDirectBuckEntrypoints,
  checkRemoteTestToolchain,
} from "./default-local-policy-rules";
import {
  checkAllowedPrimitiveInventory,
  checkRemoteReadyAmbientExecutables,
} from "./runtime-prerequisites";

export async function evaluateDefaultLocalPolicy(root = process.cwd()): Promise<PolicyReport> {
  const files = await candidatePolicyFiles(root);
  const findings = [
    ...(await checkBuckconfig(root)),
    ...(await checkRemoteTestToolchain(root)),
    ...(await checkConfigSecrets(root, files)),
    ...(await checkCiRemoteEnvDefaults(root, files)),
    ...(await checkDirectBuckEntrypoints(root, files)),
    ...(await checkAllowedPrimitiveInventory(root)),
    ...(await checkRemoteReadyAmbientExecutables(root)),
  ];
  return {
    ok: findings.length === 0,
    findings,
    dormantSurfaces: await dormantSurfaces(root),
  };
}

async function main() {
  const root = getFlagStr("root", process.cwd());
  const report = await evaluateDefaultLocalPolicy(root);
  if (report.ok) {
    console.log(
      `default-local policy passed (${report.dormantSurfaces.length} dormant remote surface(s) allowed)`,
    );
    return;
  }
  for (const item of report.findings) {
    console.error(`${item.path}: ${item.message}`);
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
