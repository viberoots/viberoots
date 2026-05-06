#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { requireFrozenProviderReplaySource } from "../../deployments/deployment-provider-frozen-snapshot";

function policy(fingerprint: string, binding: Record<string, string> = {}) {
  return {
    binding: {
      payloadFingerprint: fingerprint,
      ...binding,
    },
  };
}

function admittedContext(fingerprint = "sha256:source") {
  return {
    policyEvaluation: policy(fingerprint),
    source: {
      sourceRef: "env/pleomino/staging",
      sourceRevision: "rev-1",
      artifactIdentity: "artifact:source",
    },
    admittedSecretReferences: [],
  };
}

function replaySnapshot(context = admittedContext()) {
  return {
    deployRunId: "source-run",
    artifact: { identity: "artifact:source" },
    admittedContext: context,
  };
}

function workerSnapshot(patch: Record<string, unknown> = {}) {
  const binding = {
    sourceRunId: "source-run",
    sourceRevision: "rev-1",
    artifactIdentity: "artifact:source",
    artifactLineageId: "artifact:source",
  };
  return {
    parentRunId: "source-run",
    releaseLineageId: "source-run",
    artifactLineageId: "artifact:source",
    sourceRecord: {
      deployRunId: "source-run",
      admittedContext: admittedContext(),
    },
    replaySnapshot: replaySnapshot(),
    admittedContext: {
      policyEvaluation: policy("sha256:worker", binding),
      source: binding,
    },
    admission: {
      decision: "admitted",
      policyEvaluation: policy("sha256:worker", binding),
    },
    ...patch,
  };
}

test("frozen replay admission rejects deficient source records", () => {
  for (const admittedContextPatch of [
    { admittedSecretReferences: undefined },
    { source: { sourceRef: "env/pleomino/staging" } },
  ]) {
    assert.throws(
      () =>
        requireFrozenProviderReplaySource(
          workerSnapshot({
            sourceRecord: {
              deployRunId: "source-run",
              admittedContext: {
                ...admittedContext(),
                ...admittedContextPatch,
              },
            },
          }),
          "test-provider",
        ),
      /recorded admitted (secret references|source snapshot)/,
    );
  }
});

test("frozen replay admission rejects worker binding mismatches", () => {
  assert.throws(
    () =>
      requireFrozenProviderReplaySource(
        workerSnapshot({
          admission: {
            decision: "admitted",
            policyEvaluation: policy("sha256:worker", {
              sourceRunId: "source-run",
              sourceRevision: "rev-1",
              artifactIdentity: "artifact:other",
              artifactLineageId: "artifact:source",
            }),
          },
        }),
        "test-provider",
      ),
    /replay binding artifact mismatch/,
  );
});
