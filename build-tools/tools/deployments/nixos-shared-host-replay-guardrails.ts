#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { invalidatingTargetException } from "./deployment-target-exceptions.ts";
import { rollbackCompatibilityErrors } from "./nixos-shared-host-release-actions.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostReplaySnapshot } from "./nixos-shared-host-replay.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";

function replayMismatch(field: string, expected: string, actual: string): string {
  return `${field} mismatch: current=${expected} source=${actual}`;
}

export function sameDeploymentReplayErrors(
  current: NixosSharedHostDeployment,
  source: NixosSharedHostDeployment,
): string[] {
  const errors: string[] = [];
  const currentTargetIdentity = nixosSharedHostDeploymentTargetIdentity(current);
  const sourceTargetIdentity = nixosSharedHostDeploymentTargetIdentity(source);
  const invalidatingException = invalidatingTargetException(
    current.targetExceptions,
    sourceTargetIdentity,
    currentTargetIdentity,
  );
  if (current.deploymentId !== source.deploymentId) {
    errors.push(replayMismatch("deploymentId", current.deploymentId, source.deploymentId));
  }
  if (current.label !== source.label) {
    errors.push(replayMismatch("deploymentLabel", current.label, source.label));
  }
  if (current.provider !== source.provider) {
    errors.push(replayMismatch("provider", current.provider, source.provider));
  }
  if (currentTargetIdentity !== sourceTargetIdentity) {
    errors.push(
      invalidatingException
        ? `recorded target binding ${sourceTargetIdentity} was invalidated by ${invalidatingException.ref}`
        : replayMismatch("providerTargetIdentity", currentTargetIdentity, sourceTargetIdentity),
    );
  }
  if (current.publisher.type !== source.publisher.type) {
    errors.push(replayMismatch("publisherType", current.publisher.type, source.publisher.type));
  }
  if (current.component.kind !== source.component.kind) {
    errors.push(replayMismatch("componentKind", current.component.kind, source.component.kind));
  }
  return errors;
}

export function rollbackSourceEligibilityErrors(record: NixosSharedHostDeployRecord): string[] {
  const errors: string[] = [];
  if (record.finalOutcome !== "succeeded")
    errors.push(`non-success final outcome: ${record.finalOutcome}`);
  if (record.runClassification !== "deploy") {
    errors.push(`wrong run classification: ${record.runClassification}`);
  }
  if (record.publishMode !== "normal") errors.push(`wrong publish mode: ${record.publishMode}`);
  return errors;
}

function parseRecordTimestamp(recordPath: string): number {
  const match = path.basename(recordPath).match(/^[^-]+-(\d+)-/);
  return match ? Number(match[1]) : 0;
}

export async function latestSuccessfulNormalReplaySnapshot(opts: {
  recordsRoot: string;
  deploymentId: string;
  excludeRunId: string;
}): Promise<NixosSharedHostReplaySnapshot | undefined> {
  const runsDir = path.join(path.resolve(opts.recordsRoot), "runs");
  const entries = await fsp.readdir(runsDir).catch(() => []);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const recordPath = path.join(runsDir, entry);
        const record = JSON.parse(
          await fsp.readFile(recordPath, "utf8"),
        ) as NixosSharedHostDeployRecord;
        return { record, recordPath };
      }),
  );
  const latest = candidates
    .filter(
      ({ record }) =>
        record.deployRunId !== opts.excludeRunId &&
        record.deploymentId === opts.deploymentId &&
        record.runClassification === "deploy" &&
        record.finalOutcome === "succeeded" &&
        !!record.replaySnapshotPath,
    )
    .sort(
      (left, right) =>
        parseRecordTimestamp(right.recordPath) - parseRecordTimestamp(left.recordPath),
    )[0];
  if (!latest?.record.replaySnapshotPath) return undefined;
  return JSON.parse(
    await fsp.readFile(latest.record.replaySnapshotPath, "utf8"),
  ) as NixosSharedHostReplaySnapshot;
}

export async function liveRollbackCompatibilityErrors(opts: {
  recordsRoot: string;
  deploymentId: string;
  sourceRunId: string;
}): Promise<string[]> {
  const latest = await latestSuccessfulNormalReplaySnapshot(opts);
  return latest ? rollbackCompatibilityErrors(latest.deployment.releaseActions) : [];
}
