#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state-types";

export type DeploymentControlPlaneRestoreValidation = {
  restoredCurrentStageStateCount: number;
  retainedArtifactReferenceCount: number;
  failures: string[];
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function jsonFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) return [];
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return await jsonFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function requiredText(doc: Record<string, unknown>, field: string): boolean {
  return typeof doc[field] === "string" && String(doc[field]).trim().length > 0;
}

function restoredReferencePath(opts: {
  referencePath: string;
  recordsRoot: string;
  restoreRoot: string;
}): string {
  const resolvedRef = path.resolve(opts.referencePath);
  const resolvedRecordsRoot = path.resolve(opts.recordsRoot);
  if (
    resolvedRef === resolvedRecordsRoot ||
    resolvedRef.startsWith(`${resolvedRecordsRoot}${path.sep}`)
  ) {
    return path.join(
      path.resolve(opts.restoreRoot),
      path.relative(resolvedRecordsRoot, resolvedRef),
    );
  }
  return resolvedRef;
}

function validateRequiredFields(filePath: string, doc: Record<string, unknown>): string[] {
  return [
    "schemaVersion",
    "deploymentId",
    "environmentStage",
    "currentRunId",
    "sourceRevision",
    "artifactIdentity",
    "finalOutcome",
  ]
    .filter((field) => !requiredText(doc, field))
    .map((field) => `${filePath} missing ${field}`);
}

async function validateStateReferences(opts: {
  filePath: string;
  state: DeploymentCurrentStageState;
  recordsRoot: string;
  restoreRoot: string;
}): Promise<{ count: number; failures: string[] }> {
  const evidence = Array.isArray(opts.state.retainedRenderEvidence)
    ? opts.state.retainedRenderEvidence
    : [];
  const artifacts = Array.isArray(opts.state.retainedArtifactEvidence)
    ? opts.state.retainedArtifactEvidence
    : [];
  const failures = evidence.length > 0 ? [] : [`${opts.filePath} missing retainedRenderEvidence`];
  if (artifacts.length === 0) failures.push(`${opts.filePath} missing retainedArtifactEvidence`);
  for (const entry of evidence) {
    if (!entry.kind || !entry.referencePath) {
      failures.push(`${opts.filePath} has incomplete retainedRenderEvidence`);
      continue;
    }
    const restoredPath = restoredReferencePath({
      referencePath: entry.referencePath,
      recordsRoot: opts.recordsRoot,
      restoreRoot: opts.restoreRoot,
    });
    if (!(await pathExists(restoredPath))) {
      failures.push(`${opts.filePath} retained evidence is not restorable: ${entry.kind}`);
    }
  }
  for (const artifact of artifacts) {
    const refs = [
      { label: "stored artifact", referencePath: artifact.storedArtifactPath },
      { label: "artifact provenance", referencePath: artifact.provenancePath },
    ];
    for (const ref of refs) {
      if (!ref.referencePath) {
        failures.push(`${opts.filePath} missing ${ref.label} reference`);
        continue;
      }
      const restoredPath = restoredReferencePath({
        referencePath: ref.referencePath,
        recordsRoot: opts.recordsRoot,
        restoreRoot: opts.restoreRoot,
      });
      if (!(await pathExists(restoredPath))) {
        failures.push(`${opts.filePath} ${ref.label} is not restorable`);
      }
    }
  }
  return { count: evidence.length + artifacts.length * 2, failures };
}

export async function validateRestoredCurrentStageState(opts: {
  recordsRoot: string;
  restoreRoot: string;
}): Promise<DeploymentControlPlaneRestoreValidation> {
  const stateRoot = path.join(opts.restoreRoot, "control-plane", "current-stage-state");
  const files = await jsonFiles(stateRoot);
  const validations = await Promise.all(
    files.map(async (filePath) => {
      const doc = JSON.parse(await fsp.readFile(filePath, "utf8")) as Record<string, unknown>;
      const fieldFailures = validateRequiredFields(filePath, doc);
      const referenceValidation = await validateStateReferences({
        filePath,
        state: doc as DeploymentCurrentStageState,
        recordsRoot: opts.recordsRoot,
        restoreRoot: opts.restoreRoot,
      });
      return {
        retainedArtifactReferenceCount: referenceValidation.count,
        failures: [...fieldFailures, ...referenceValidation.failures],
      };
    }),
  );
  return {
    restoredCurrentStageStateCount: files.length,
    retainedArtifactReferenceCount: validations.reduce(
      (sum, validation) => sum + validation.retainedArtifactReferenceCount,
      0,
    ),
    failures: validations.flatMap((validation) => validation.failures),
  };
}
