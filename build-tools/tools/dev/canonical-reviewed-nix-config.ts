import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  artifactSelectorNames,
  assertNoArtifactSelectorInjection,
} from "../lib/artifact-environment-policy";
import { activateNixCachePolicyCapabilityAfterCanonicalEntry } from "../lib/nix-cache-policy-capability";

const CANONICAL_ENV_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "NIX_CONFIG",
  "NIX_REMOTE",
  "NIX_SSL_CERT_FILE",
  "PATH",
  "SSL_CERT_FILE",
  "SOURCE_DATE_EPOCH",
  "TMPDIR",
  "TZ",
  "VBR_ARTIFACT_TOOLS_ROOT",
  "VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST",
  "VBR_NIX_BIN",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "ZX_INIT",
] as const;

const MAX_REVIEWED_CONFIG_PROOF_BYTES = 128;
const MAX_REVIEWED_CONFIG_PROOF_FD = 1024;

export type ReviewedNixConfigOutcome = {
  applied: boolean;
  config: string;
};

function reviewedConfigDigest(config: string): string {
  return createHash("sha256").update(`applied-v1\0${config}`).digest("hex");
}

export function canonicalReviewedConfig(env: NodeJS.ProcessEnv): {
  applied: boolean;
  config: string;
  valid: boolean;
} {
  const config = String(env.NIX_CONFIG || "");
  const digest = String(env.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST || "");
  if (!digest) return { applied: false, config, valid: !config };
  return {
    applied: true,
    config,
    valid: digest === reviewedConfigDigest(config),
  };
}

function reviewedConfigProofFd(env: NodeJS.ProcessEnv): number {
  const raw = String(env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD || "");
  if (!/^[0-9]+$/u.test(raw)) return -1;
  const fd = Number(raw);
  return Number.isSafeInteger(fd) && fd >= 10 && fd <= MAX_REVIEWED_CONFIG_PROOF_FD ? fd : -1;
}

function readBoundedReviewedConfigProof(fd: number): string {
  const stat = fs.fstatSync(fd);
  if (
    (!stat.isFile() && !stat.isFIFO()) ||
    (stat.isFile() && (stat.size < 2 || stat.size > MAX_REVIEWED_CONFIG_PROOF_BYTES))
  ) {
    return "";
  }
  const proof = Buffer.alloc(MAX_REVIEWED_CONFIG_PROOF_BYTES + 1);
  const bytesRead = fs.readSync(fd, proof, 0, proof.length, null);
  if (bytesRead < 2 || bytesRead > MAX_REVIEWED_CONFIG_PROOF_BYTES) return "";
  const encoded = proof.subarray(0, bytesRead).toString("utf8");
  if (!encoded.endsWith("\n") || encoded.slice(0, -1).includes("\n")) return "";
  return encoded.slice(0, -1);
}

export function consumeArtifactIngressReviewedNixConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReviewedNixConfigOutcome {
  const proofFd = reviewedConfigProofFd(env);
  const token = String(env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN || "");
  const applied = env.VBR_NIX_CACHE_HEALTH_APPLIED === "1";
  const reviewed = String(env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG || "");
  delete env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD;
  delete env.VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN;
  delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
  delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  if (!token || proofFd < 0) return { applied: false, config: "" };
  let proof = "";
  try {
    proof = readBoundedReviewedConfigProof(proofFd);
  } catch {
    return { applied: false, config: "" };
  } finally {
    try {
      fs.closeSync(proofFd);
    } catch {}
  }
  return proof === token && applied
    ? { applied: true, config: reviewed }
    : { applied: false, config: "" };
}

export function attachCanonicalReviewedNixConfig(
  env: NodeJS.ProcessEnv,
  outcome: ReviewedNixConfigOutcome,
): NodeJS.ProcessEnv {
  if (!outcome.applied) return env;
  if (outcome.config) env.NIX_CONFIG = outcome.config;
  else delete env.NIX_CONFIG;
  env.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST = reviewedConfigDigest(outcome.config);
  return env;
}

export function activateCanonicalNixCachePolicy(
  env: NodeJS.ProcessEnv,
  outcome: ReviewedNixConfigOutcome,
): void {
  const policy = outcome.applied
    ? ({ kind: "reviewed", config: outcome.config } as const)
    : env.VBR_NIX_CACHE_POLICY === "off"
      ? ({ kind: "off" } as const)
      : null;
  if (!policy) return;
  if (env.VBR_CANONICAL_ARTIFACT_ENTRYPOINT !== "1") {
    throw new Error("cannot activate Nix cache policy authority before canonical entry");
  }
  delete env.VBR_CANONICAL_REVIEWED_NIX_CONFIG_DIGEST;
  if (policy.kind === "reviewed") {
    env.VBR_NIX_CACHE_HEALTH_APPLIED = "1";
    env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG = policy.config;
  } else {
    delete env.VBR_NIX_CACHE_HEALTH_APPLIED;
    delete env.VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG;
  }
  activateNixCachePolicyCapabilityAfterCanonicalEntry(env, policy);
}

export function canonicalArtifactEnvironmentDifferences(
  actual: NodeJS.ProcessEnv,
  expected: NodeJS.ProcessEnv,
): string[] {
  const differences: string[] = [];
  if (actual.VBR_CANONICAL_ARTIFACT_ENTRYPOINT !== "1") differences.push("canonical-marker");
  for (const name of CANONICAL_ENV_KEYS) {
    if (actual[name] !== expected[name]) differences.push(name);
  }
  const allowed = new Set(["VBR_ARTIFACT_TOOLS_ROOT"]);
  const actualReviewed = canonicalReviewedConfig(actual);
  const expectedReviewed = canonicalReviewedConfig(expected);
  if (!actualReviewed.valid || !expectedReviewed.valid) {
    differences.push("reviewed-nix-config-digest");
  } else if (actualReviewed.config && actualReviewed.config === expectedReviewed.config) {
    allowed.add("NIX_CONFIG");
  }
  for (const name of artifactSelectorNames()) {
    if (!allowed.has(name) && String(actual[name] || "").trim()) differences.push(name);
  }
  try {
    assertNoArtifactSelectorInjection(actual, {
      allow: [...allowed],
      rejectUnknownArtifactAffecting: true,
    });
  } catch (error) {
    differences.push(error instanceof Error ? error.message : "artifact-selector-injection");
  }
  return [...new Set(differences)];
}

export function isCanonicalArtifactEntrypointEnvironment(
  actual: NodeJS.ProcessEnv,
  expected: NodeJS.ProcessEnv,
): boolean {
  return canonicalArtifactEnvironmentDifferences(actual, expected).length === 0;
}
