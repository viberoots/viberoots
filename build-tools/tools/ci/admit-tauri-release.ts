#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { getFlagStr } from "../lib/cli";
import {
  protectedStoreRoot,
  verifyProtectedStoreSignature,
} from "../lib/protected-store-signature";
import { readProtectedReproducibilityAggregate } from "../lib/protected-reproducibility-aggregate";
import { runArtifactNix } from "./artifact-command";
import { admitTauriExternalRelease } from "./tauri-release-admission";
import {
  readVerifiedTauriQualification,
  readVerifiedTauriReleaseEvidence,
} from "./tauri-release-evidence-reader";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const runNix = async (args: string[]) =>
    await runArtifactNix({ args, workspaceRoot, artifactToolsRoot });
  const aggregateFile = required("qualification-aggregate");
  const evidenceStoreLocator = required("evidence-store-locator");
  const signed = await readProtectedReproducibilityAggregate(
    aggregateFile,
    evidenceStoreLocator,
    runNix,
  );
  const policyFile = required("release-policy");
  await runNix(["copy", "--from", signed.evidenceStoreUri, protectedStoreRoot(policyFile)]);
  await verifyProtectedStoreSignature(policyFile, runNix);
  const policy = parsePolicy(JSON.parse(await fs.readFile(policyFile, "utf8")));
  const qualification = await readVerifiedTauriQualification({ signed, runNix });
  const verifiedEvidence = await readVerifiedTauriReleaseEvidence({
    file: required("external-evidence"),
    evidenceStoreUri: signed.evidenceStoreUri,
    runNix,
  });
  const admission = admitTauriExternalRelease({
    qualification,
    verifiedEvidence,
    trustedSignerIdentities: policy.trustedSignerIdentities,
    trustedNotaryIdentities: policy.trustedNotaryIdentities,
  });
  const outputRoot = path.resolve(required("output-root"));
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
  await fs.writeFile(path.join(outputRoot, "admission.json"), `${JSON.stringify(admission)}\n`, {
    flag: "wx",
    mode: 0o444,
  });
}

function parsePolicy(value: unknown): {
  trustedSignerIdentities: string[];
  trustedNotaryIdentities: string[];
} {
  const policy = value as {
    schema?: unknown;
    trustedSignerIdentities?: unknown;
    trustedNotaryIdentities?: unknown;
  };
  if (
    Object.keys(policy).sort().join("\0") !==
      ["schema", "trustedNotaryIdentities", "trustedSignerIdentities"].sort().join("\0") ||
    policy.schema !== "viberoots.tauri-release-policy.v1" ||
    !Array.isArray(policy.trustedSignerIdentities) ||
    !Array.isArray(policy.trustedNotaryIdentities)
  ) {
    throw new Error("Tauri release policy is invalid");
  }
  const trustedSignerIdentities = canonicalReviewed(policy.trustedSignerIdentities);
  const trustedNotaryIdentities = canonicalReviewed(policy.trustedNotaryIdentities);
  if (!trustedSignerIdentities.length || !trustedNotaryIdentities.length) {
    throw new Error("Tauri release policy requires signer and notary identities");
  }
  return { trustedSignerIdentities, trustedNotaryIdentities };
}

function canonicalReviewed(value: unknown[]): string[] {
  const entries = value.map(String);
  if (
    entries.some((entry) => !/^reviewed:[a-z0-9][a-z0-9._-]*$/u.test(entry)) ||
    entries.join("\0") !== [...new Set(entries)].sort().join("\0")
  ) {
    throw new Error("Tauri release policy identities are not canonical reviewed identities");
  }
  return entries;
}

function required(name: string): string {
  const value = getFlagStr(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

await main();
