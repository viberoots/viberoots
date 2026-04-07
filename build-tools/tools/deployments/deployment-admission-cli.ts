#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { getFlagStr } from "../lib/cli.ts";
import {
  normalizeAdmissionEvidence,
  type DeploymentAdmissionEvidence,
} from "./deployment-admission-evidence.ts";

export async function resolveDeploymentAdmissionEvidence(): Promise<
  DeploymentAdmissionEvidence | undefined
> {
  const evidenceJson = getFlagStr("admission-evidence-json", "").trim();
  if (!evidenceJson) return undefined;
  const parsed = JSON.parse(await fsp.readFile(evidenceJson, "utf8"));
  const evidence = normalizeAdmissionEvidence(parsed);
  if (!evidence) {
    throw new Error(`invalid --admission-evidence-json payload: ${evidenceJson}`);
  }
  return evidence;
}
