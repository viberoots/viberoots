#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph.ts";
import { artifactDirFromBuiltOutPath } from "./deployment-component-artifact-dirs.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  createStaticWebappArtifactBundleBytes,
  digestStaticWebappArtifactBundleBytes,
  materializeStaticWebappArtifactBundle,
} from "./static-webapp-artifact-bundle.ts";
import {
  admitStaticWebappArtifact,
  readAdmittedStaticWebappArtifact,
  requireAdmittedStaticWebappArtifactPath,
  type AdmittedStaticWebappArtifact,
} from "./static-webapp-artifacts.ts";
import { admitStaticWebappUploadSession } from "./static-webapp-upload-sessions.ts";
import { resolveDeploymentGitCommit } from "./deployment-git-ref.ts";

export type CloudflarePagesArtifactInput =
  | {
      kind: "server_build";
      sourceRevision: string;
      deploymentLabel: string;
      buildTarget: string;
      buildPolicy: "reviewed_target";
    }
  | {
      kind: "client_upload";
      uploadSessionId: string;
      sourceRevision: string;
      sourceDirty?: boolean;
      deploymentLabel: string;
      buildTarget: string;
    }
  | {
      kind: "ci_attested";
      artifactRef: string;
      artifactDigest: string;
      sourceRevision: string;
      deploymentLabel: string;
      buildTarget: string;
      ciRunId: string;
    }
  | {
      kind: "existing_admitted_artifact";
      artifact?: AdmittedStaticWebappArtifact;
      artifactIdentity?: string;
    };

async function verifySourceRevision(workspaceRoot: string, sourceRevision: string) {
  const revision = sourceRevision.trim();
  if (!revision) throw new Error("artifact input requires sourceRevision");
  await resolveDeploymentGitCommit({
    workspaceRoot,
    revision,
    purpose: "artifact input source revision",
  });
}

async function admitBundleRef(opts: {
  recordsRoot: string;
  artifactRef: string;
  producer: {
    sourceRevision: string;
    deploymentLabel: string;
    buildTarget: string;
    artifactDigest: string;
    ciRunId: string;
  };
}): Promise<AdmittedStaticWebappArtifact> {
  const url = new URL(opts.artifactRef);
  if (url.protocol !== "file:") {
    throw new Error(`unsupported ci_attested artifactRef protocol: ${url.protocol}`);
  }
  const archiveBytes = await fsp.readFile(url);
  if (digestStaticWebappArtifactBundleBytes(archiveBytes) !== opts.producer.artifactDigest) {
    throw new Error("ci_attested artifact digest does not match referenced artifact");
  }
  const materialized = path.join(
    path.resolve(opts.recordsRoot),
    "artifacts",
    "ci-attested",
    opts.producer.artifactDigest.replace(/[^A-Za-z0-9_.-]/g, "_"),
  );
  await materializeStaticWebappArtifactBundle(archiveBytes, materialized);
  return await admitStaticWebappArtifact({
    recordsRoot: opts.recordsRoot,
    artifactDir: materialized,
    producer: {
      producerKind: "ci_attested",
      sourceRevision: opts.producer.sourceRevision,
      deploymentLabel: opts.producer.deploymentLabel,
      buildTarget: opts.producer.buildTarget,
      storageReference: opts.artifactRef,
      archiveDigest: opts.producer.artifactDigest,
      ciRunId: opts.producer.ciRunId,
    },
  });
}

async function admitServerBuild(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: CloudflarePagesDeployment;
  input: Extract<CloudflarePagesArtifactInput, { kind: "server_build" }>;
}): Promise<AdmittedStaticWebappArtifact> {
  await verifySourceRevision(opts.workspaceRoot, opts.input.sourceRevision);
  const outPath = await buildSelectedOutPath(opts.workspaceRoot, opts.input.buildTarget);
  const artifactDir = artifactDirFromBuiltOutPath(opts.deployment.component.kind, outPath);
  return await admitStaticWebappArtifact({
    recordsRoot: opts.recordsRoot,
    artifactDir,
    producer: {
      producerKind: "server_build",
      sourceRevision: opts.input.sourceRevision,
      deploymentLabel: opts.input.deploymentLabel,
      buildTarget: opts.input.buildTarget,
      storageReference: `server-build:${opts.input.buildTarget}`,
    },
  });
}

export async function resolveCloudflarePagesArtifactInput(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: CloudflarePagesDeployment;
  submissionId: string;
  artifactInput: CloudflarePagesArtifactInput;
}): Promise<AdmittedStaticWebappArtifact> {
  const input = opts.artifactInput;
  if (input.kind === "existing_admitted_artifact") {
    const artifact = input.artifact
      ? input.artifact
      : await readAdmittedStaticWebappArtifact({
          recordsRoot: opts.recordsRoot,
          artifactIdentity: String(input.artifactIdentity || ""),
        });
    await requireAdmittedStaticWebappArtifactPath(artifact);
    return artifact;
  }
  if (input.kind === "client_upload") {
    if (input.sourceDirty) {
      throw new Error("client_upload artifact input must come from a clean reviewed source state");
    }
    await verifySourceRevision(opts.workspaceRoot, input.sourceRevision);
    return await admitStaticWebappUploadSession({
      recordsRoot: opts.recordsRoot,
      uploadSessionId: input.uploadSessionId,
      submissionId: opts.submissionId,
      deploymentLabel: input.deploymentLabel,
      sourceRevision: input.sourceRevision,
      buildTarget: input.buildTarget,
    });
  }
  if (input.kind === "ci_attested") {
    await verifySourceRevision(opts.workspaceRoot, input.sourceRevision);
    return await admitBundleRef({
      recordsRoot: opts.recordsRoot,
      artifactRef: input.artifactRef,
      producer: input,
    });
  }
  return await admitServerBuild({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deployment: opts.deployment,
    input,
  });
}

export async function localClientUploadArtifactDigest(artifactDir: string): Promise<string> {
  return digestStaticWebappArtifactBundleBytes(
    await createStaticWebappArtifactBundleBytes(artifactDir),
  );
}
