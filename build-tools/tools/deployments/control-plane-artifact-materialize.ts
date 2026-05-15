#!/usr/bin/env zx-wrapper
import { materializeArtifactObject, verifyArtifactObject } from "./control-plane-artifact-store";
import type {
  ControlPlaneArtifactObject,
  ControlPlaneArtifactStore,
} from "./control-plane-artifact-store-types";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts";
import { writeControlPlaneJson } from "./nixos-shared-host-control-plane-store";

function assertObjectProvenance(
  object: Pick<ControlPlaneArtifactObject, "key" | "provenance">,
  expected: Record<string, string | undefined>,
) {
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && object.provenance[field] !== value) {
      throw new Error(`artifact object ${field} provenance mismatch for ${object.key}`);
    }
  }
}

function allowPriorSubmissionArtifact(artifact: { producerKind?: string }, explicit: boolean) {
  return explicit || artifact.producerKind === "existing_admitted_artifact";
}

function allowProviderPriorSubmission(snapshot: NixosSharedHostControlPlaneSnapshot) {
  const operationKind = (snapshot as any).operationKind;
  return (
    ["promotion", "retry", "rollback"].includes(operationKind) &&
    (typeof (snapshot as any).sourceRunId === "string" || !!(snapshot as any).sourceRecord)
  );
}

function assertArtifactObjectProvenance(opts: {
  artifact: { identity: string; object?: ControlPlaneArtifactObject; producerKind?: string };
  snapshot: Pick<NixosSharedHostControlPlaneSnapshot, "deploymentId" | "submissionId">;
  allowPriorSubmission?: boolean;
}) {
  if (!opts.artifact.object) return;
  assertObjectProvenance(opts.artifact.object, {
    payloadKind: "artifact",
    deploymentId: opts.snapshot.deploymentId,
    artifactIdentity: opts.artifact.identity,
    ...(allowPriorSubmissionArtifact(opts.artifact, opts.allowPriorSubmission ?? false)
      ? {}
      : { submissionId: opts.snapshot.submissionId }),
  });
}

async function materializeOne(
  artifact: NixosSharedHostAdmittedArtifact,
  store: ControlPlaneArtifactStore,
  outputRoot: string,
  snapshot: NixosSharedHostControlPlaneSnapshot,
) {
  if (!artifact.object) return;
  assertArtifactObjectProvenance({ artifact, snapshot });
  artifact.storedArtifactPath = await materializeArtifactObject({
    store,
    object: artifact.object,
    outputRoot,
    identity: artifact.identity,
  });
}

async function materializeProviderArtifactObject(
  artifact: {
    identity: string;
    object?: ControlPlaneArtifactObject;
    storedArtifactPath?: string;
    producerKind?: string;
  },
  store: ControlPlaneArtifactStore,
  outputRoot: string,
  snapshot: NixosSharedHostControlPlaneSnapshot,
  allowPriorSubmission = false,
) {
  if (!artifact.object) return;
  assertArtifactObjectProvenance({ artifact, snapshot, allowPriorSubmission });
  artifact.storedArtifactPath = await materializeArtifactObject({
    store,
    object: artifact.object,
    outputRoot,
    identity: artifact.identity,
  });
}

async function materializeProviderOutputObject(
  artifact: {
    identity: string;
    object?: ControlPlaneArtifactObject;
    outputDir?: string;
    producerKind?: string;
  },
  store: ControlPlaneArtifactStore,
  outputRoot: string,
  snapshot: NixosSharedHostControlPlaneSnapshot,
  allowPriorSubmission = false,
) {
  if (!artifact.object) return;
  assertArtifactObjectProvenance({ artifact, snapshot, allowPriorSubmission });
  artifact.outputDir = await materializeArtifactObject({
    store,
    object: artifact.object,
    outputRoot,
    identity: artifact.identity,
  });
}

export async function materializeSnapshotArtifacts(opts: {
  snapshot: NixosSharedHostControlPlaneSnapshot;
  store?: ControlPlaneArtifactStore;
  outputRoot: string;
  executionSnapshotPath?: string;
}): Promise<NixosSharedHostControlPlaneSnapshot> {
  let snapshot = opts.snapshot;
  const snapshotObject = (opts.snapshot as any).executionSnapshotObject;
  if (snapshotObject) {
    if (!opts.store) throw new Error("artifact object store is required for execution snapshots");
    const bytes = await verifyArtifactObject({ store: opts.store, object: snapshotObject });
    const storedSnapshot = JSON.parse(
      bytes.toString("utf8"),
    ) as NixosSharedHostControlPlaneSnapshot;
    if (
      storedSnapshot.submissionId !== opts.snapshot.submissionId ||
      snapshotObject.provenance.submissionId !== opts.snapshot.submissionId ||
      snapshotObject.provenance.deploymentId !== opts.snapshot.deploymentId ||
      snapshotObject.provenance.payloadKind !== "execution-snapshot"
    ) {
      throw new Error(
        `execution snapshot object provenance mismatch for ${opts.snapshot.submissionId}`,
      );
    }
    (storedSnapshot as any).executionSnapshotObject = snapshotObject;
    snapshot = storedSnapshot;
  }
  const publishInput =
    (snapshot.action as any)?.kind === "deploy" ? (snapshot.action as any).publishInput : undefined;
  if (!publishInput) {
    const providerSnapshot = snapshot as any;
    if (providerSnapshot.artifact?.object) {
      if (!opts.store) throw new Error("artifact object store is required for provider execution");
      if (typeof providerSnapshot.artifact.outputDir === "string") {
        await materializeProviderOutputObject(
          providerSnapshot.artifact,
          opts.store,
          opts.outputRoot,
          snapshot,
          allowProviderPriorSubmission(snapshot),
        );
      } else {
        await materializeProviderArtifactObject(
          providerSnapshot.artifact,
          opts.store,
          opts.outputRoot,
          snapshot,
          allowProviderPriorSubmission(snapshot),
        );
      }
    }
    for (const component of providerSnapshot.componentArtifacts || []) {
      if (!component.object) continue;
      if (!opts.store) throw new Error("artifact object store is required for provider execution");
      await materializeProviderArtifactObject(
        component,
        opts.store,
        opts.outputRoot,
        snapshot,
        allowProviderPriorSubmission(snapshot),
      );
    }
    if (providerSnapshot.replaySnapshot?.artifact?.object) {
      if (!opts.store) throw new Error("artifact object store is required for provider execution");
      const artifact = providerSnapshot.replaySnapshot.artifact;
      if (typeof artifact.outputDir === "string") {
        await materializeProviderOutputObject(
          artifact,
          opts.store,
          opts.outputRoot,
          snapshot,
          true,
        );
      } else {
        await materializeProviderArtifactObject(
          artifact,
          opts.store,
          opts.outputRoot,
          snapshot,
          true,
        );
      }
    }
    for (const component of providerSnapshot.replaySnapshot?.componentArtifacts || []) {
      if (!component.object) continue;
      if (!opts.store) throw new Error("artifact object store is required for provider execution");
      await materializeProviderArtifactObject(
        component,
        opts.store,
        opts.outputRoot,
        snapshot,
        true,
      );
    }
    if (opts.executionSnapshotPath)
      await writeControlPlaneJson(opts.executionSnapshotPath, snapshot);
    return snapshot;
  }
  const artifacts =
    publishInput.kind === "exact-artifact"
      ? [publishInput.artifact]
      : publishInput.components.map((component) => component.artifact);
  if (artifacts.some((artifact) => artifact.object) && !opts.store) {
    throw new Error("artifact object store is required for backend worker execution");
  }
  for (const artifact of artifacts) {
    await materializeOne(artifact, opts.store!, opts.outputRoot, snapshot);
  }
  if (opts.executionSnapshotPath) await writeControlPlaneJson(opts.executionSnapshotPath, snapshot);
  return snapshot;
}
