#!/usr/bin/env zx-wrapper

function policyFingerprint(admittedContext: any): string {
  return String(admittedContext?.policyEvaluation?.binding?.payloadFingerprint || "").trim();
}

function replayArtifactIdentity(replaySnapshot: any): string {
  return String(
    replaySnapshot?.artifact?.identity || replaySnapshot?.artifactIdentity || "",
  ).trim();
}

export function requireReplayAdmittedContext(opts: { provider: string; admittedContext: any }) {
  const fingerprint = policyFingerprint(opts.admittedContext);
  if (!fingerprint) {
    throw new Error(`${opts.provider} replay requires recorded admitted policy evaluation`);
  }
  if (!opts.admittedContext?.source?.sourceRef || !opts.admittedContext?.source?.sourceRevision) {
    throw new Error(`${opts.provider} replay requires recorded admitted source snapshot`);
  }
  if (!Array.isArray(opts.admittedContext.admittedSecretReferences)) {
    throw new Error(`${opts.provider} replay requires recorded admitted secret references`);
  }
  return opts.admittedContext;
}

export function assertReplayAdmissionMatchesRecord(opts: {
  provider: string;
  record: any;
  replaySnapshot: any;
}) {
  requireReplayAdmittedContext({
    provider: opts.provider,
    admittedContext: opts.record?.admittedContext,
  });
  requireReplayAdmittedContext({
    provider: opts.provider,
    admittedContext: opts.replaySnapshot?.admittedContext,
  });
  if (
    opts.record?.deployRunId &&
    opts.replaySnapshot?.deployRunId &&
    opts.record.deployRunId !== opts.replaySnapshot.deployRunId
  ) {
    throw new Error(`${opts.provider} replay snapshot does not match source record run id`);
  }
  const recordFingerprint = policyFingerprint(opts.record?.admittedContext);
  const replayFingerprint = policyFingerprint(opts.replaySnapshot?.admittedContext);
  if (!recordFingerprint || !replayFingerprint || recordFingerprint !== replayFingerprint) {
    throw new Error(`${opts.provider} replay rejects mismatched admitted policy evidence`);
  }
}

export function assertFrozenReplayAdmissionMatchesSnapshot(opts: {
  provider: string;
  snapshot: any;
}) {
  const binding = opts.snapshot?.admission?.policyEvaluation?.binding || {};
  const replay = opts.snapshot?.replaySnapshot || {};
  const replaySource = replay.admittedContext?.source || {};
  const artifactIdentity = replayArtifactIdentity(replay);
  if (!binding.sourceRunId || binding.sourceRunId !== replay.deployRunId) {
    throw new Error(`${opts.provider} worker rejects replay binding source run mismatch`);
  }
  if (!binding.sourceRevision || binding.sourceRevision !== replaySource.sourceRevision) {
    throw new Error(`${opts.provider} worker rejects replay binding source revision mismatch`);
  }
  if (!binding.artifactIdentity || binding.artifactIdentity !== artifactIdentity) {
    throw new Error(`${opts.provider} worker rejects replay binding artifact mismatch`);
  }
  if (
    binding.artifactLineageId &&
    opts.snapshot?.artifactLineageId &&
    binding.artifactLineageId !== opts.snapshot.artifactLineageId
  ) {
    throw new Error(`${opts.provider} worker rejects replay binding lineage mismatch`);
  }
}
