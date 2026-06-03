import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import {
  PHASES,
  type AwsAccountConfig,
  type Phase,
  type PhaseState,
  type RunDeps,
} from "./aws-account-types";
import { isoNow, pathExists, printJson } from "./aws-account-utils";
import { readStatus } from "./aws-account-status";

export async function printStatus(config: AwsAccountConfig, deps: RunDeps): Promise<void> {
  printJson(await readStatus(config), deps);
}

export async function validateEvidence(config: AwsAccountConfig, deps: RunDeps): Promise<void> {
  const status = await readStatus(config);
  const now = isoNow(deps);
  const maxAgeMinutes = Number(getFlagStr("max-age-minutes", "1440").trim() || "1440");
  const missing: string[] = [];
  const schemaErrors: string[] = [];
  const stale: string[] = [];
  const redactionFindings: string[] = [];
  for (const phase of PHASES) {
    const evidence = status.phases[phase]?.evidence;
    const state = status.phases[phase]?.state;
    if (
      (state === "passed" || state === "manual") &&
      (!evidence || !(await pathExists(evidence)))
    ) {
      missing.push(phase);
      continue;
    }
    if ((state === "passed" || state === "manual") && evidence) {
      const value = await readJsonEvidence(evidence, schemaErrors, phase);
      if (value) {
        validateEvidenceSchema(phase, state, value, schemaErrors);
        validateEvidenceFreshness(phase, value, now, maxAgeMinutes, stale);
        scanForSecretEvidence(phase, value, redactionFindings);
      }
    }
  }
  const result = {
    schemaVersion: "aws-account-evidence-summary@1",
    checkedAt: now,
    maxAgeMinutes,
    ok:
      missing.length === 0 &&
      schemaErrors.length === 0 &&
      stale.length === 0 &&
      redactionFindings.length === 0,
    missing,
    schemaErrors,
    stale,
    redactionFindings,
    status,
  };
  printJson(result, deps);
  if (!result.ok) process.exitCode = 2;
}

async function readJsonEvidence(
  evidence: string,
  schemaErrors: string[],
  phase: Phase,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await fsp.readFile(evidence, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      schemaErrors.push(`${phase}: evidence root must be a JSON object`);
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    schemaErrors.push(
      `${phase}: evidence JSON parse failed: ${String(error instanceof Error ? error.message : error)}`,
    );
    return undefined;
  }
}

function validateEvidenceSchema(
  phase: Phase,
  state: PhaseState,
  value: Record<string, unknown>,
  schemaErrors: string[],
): void {
  const expected: Partial<Record<Phase, string[]>> = {
    "check-tools": ["aws-account-tools@1"],
    "check-aws-login": ["aws-account-aws-login@1"],
    "check-supabase": ["aws-account-supabase-readiness@1"],
    "bootstrap-state":
      state === "manual"
        ? ["aws-account-bootstrap-state-plan@1"]
        : ["aws-account-bootstrap-state-apply@1"],
  };
  const allowed = expected[phase];
  if (!allowed) return;
  const actual = typeof value.schemaVersion === "string" ? value.schemaVersion : "";
  if (!allowed.includes(actual)) {
    schemaErrors.push(
      `${phase}: expected schemaVersion ${allowed.join(" or ")}, got ${actual || "<missing>"}`,
    );
  }
}

function validateEvidenceFreshness(
  phase: Phase,
  value: Record<string, unknown>,
  nowIso: string,
  maxAgeMinutes: number,
  stale: string[],
): void {
  const checkedAt = typeof value.checkedAt === "string" ? value.checkedAt : "";
  const checkedMs = Date.parse(checkedAt);
  const nowMs = Date.parse(nowIso);
  if (!checkedAt || !Number.isFinite(checkedMs)) {
    stale.push(`${phase}: evidence missing valid checkedAt`);
    return;
  }
  if (
    Number.isFinite(maxAgeMinutes) &&
    maxAgeMinutes >= 0 &&
    nowMs - checkedMs > maxAgeMinutes * 60_000
  ) {
    stale.push(`${phase}: evidence is older than ${maxAgeMinutes} minutes`);
  }
}

function scanForSecretEvidence(
  phase: Phase,
  value: unknown,
  findings: string[],
  pathParts: string[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanForSecretEvidence(phase, entry, findings, [...pathParts, String(index)]),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = [...pathParts, key];
    if (typeof child === "string" && child.trim()) {
      const keyName = key.toLowerCase();
      if (
        /(token|secret|password|apikey|api_key|authorization)/.test(keyName) &&
        !/(env|path|name|arn|schema|ref|category|source)/.test(keyName)
      ) {
        findings.push(`${phase}: possible secret value at ${path.join(".")}`);
      }
      if (
        !/(env|path|name|arn|schema|ref|category|source)/.test(keyName) &&
        /sbp_[A-Za-z0-9_=-]+|SUPABASE_ACCESS_TOKEN|AWS_SECRET_ACCESS_KEY/.test(child)
      ) {
        findings.push(`${phase}: possible secret literal at ${path.join(".")}`);
      }
    }
    scanForSecretEvidence(phase, child, findings, path);
  }
}

export async function cleanEvidence(config: AwsAccountConfig, deps: RunDeps): Promise<void> {
  const repoRoot = await findRepoRoot(deps.cwd || process.cwd());
  const abs = path.resolve(deps.cwd || process.cwd(), config.evidenceDir);
  const allowedRoot = path.join(repoRoot, "buck-out", "aws-account");
  if (!abs.startsWith(allowedRoot + path.sep)) {
    throw new Error(`clean refuses to remove evidence dir outside ${allowedRoot}: ${abs}`);
  }
  if (!getFlagBool("confirm")) {
    throw new Error("clean requires --confirm and only removes local generated evidence files");
  }
  await fsp.rm(abs, { recursive: true, force: true });
  printJson({ ok: true, removed: abs }, deps);
}
