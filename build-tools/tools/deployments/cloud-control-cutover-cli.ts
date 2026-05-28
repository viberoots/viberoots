import * as fsp from "node:fs/promises";
import { getFlagList, getFlagStr } from "../lib/cli";
import {
  CUTOVER_OPERATIONS,
  type CutoverEvidence,
  type CutoverOperation,
} from "./cloud-control-cutover-types";
import { validateCloudControlCutover } from "./cloud-control-cutover-validate";

export async function runCloudControlCutoverCommand() {
  const evidencePath = getFlagStr("evidence", "").trim();
  if (!evidencePath) throw new Error("cutover validation requires --evidence <path>");
  const operation = operationFlag();
  const evidence = JSON.parse(await fsp.readFile(evidencePath, "utf8")) as CutoverEvidence;
  const expectedHostProfile = getFlagStr("expected-host-profile", "").trim();
  if (!expectedHostProfile) {
    throw new Error("cutover validation requires --expected-host-profile <trusted-host-profile>");
  }
  const expectedImageBuildIdentity = getFlagStr("expected-image-build-identity", "").trim();
  if (!expectedImageBuildIdentity) {
    throw new Error("cutover validation requires --expected-image-build-identity <nix-source>");
  }
  const result = validateCloudControlCutover(evidence, {
    operation,
    expectedHostProfile,
    expectedImageBuildIdentity,
    expectedRegion: getFlagStr("expected-region", "").trim() || undefined,
    selectedCapabilities: selectedCapabilities(evidence),
    maxAgeMinutes: Number(getFlagStr("max-age-minutes", "1440").trim() || "1440"),
  });
  const out = getFlagStr("out", "").trim();
  const report = `${JSON.stringify(result, null, 2)}\n`;
  if (out) await fsp.writeFile(out, report, "utf8");
  else console.log(report.trimEnd());
  if (!result.ok) throw new Error(`cloud cutover validation failed: ${result.errors.join("; ")}`);
  return result;
}

function operationFlag(): CutoverOperation {
  const raw = getFlagStr("operation", "cutover").trim();
  if (!CUTOVER_OPERATIONS.includes(raw as CutoverOperation)) {
    throw new Error(`unsupported cutover operation ${raw}`);
  }
  return raw as CutoverOperation;
}

function selectedCapabilities(evidence: CutoverEvidence): string[] {
  const selected = getFlagList("selected-capability");
  if (selected.length > 0) return selected;
  return Object.keys(evidence.providerCapabilities || {});
}
