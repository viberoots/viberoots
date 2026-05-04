#!/usr/bin/env zx-wrapper
import { createStaticWebappArtifactBundleBytes } from "./static-webapp-artifact-bundle";
import type { CloudflarePagesArtifactInput } from "./cloudflare-pages-artifact-input";
import type { CloudflarePagesDeployment } from "./contract";

type UploadResponse = {
  uploadSessionId: string;
  archiveDigest: string;
  archiveFormat: string;
};

function authHeaders(token?: string) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readUploadResponse(response: Response): Promise<UploadResponse> {
  const body = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      throw new Error(parsed.error || body.trim() || `artifact upload failed: ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body.trim() || `artifact upload failed: ${response.status}`);
      }
      throw error;
    }
  }
  return JSON.parse(body) as UploadResponse;
}

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

async function sourceState(workspaceRoot: string) {
  const sourceRevision = await gitStdout(workspaceRoot, ["rev-parse", "HEAD"]);
  return { sourceRevision };
}

export async function uploadCloudflarePagesClientArtifact(opts: {
  workspaceRoot: string;
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  submissionId: string;
  deployment: CloudflarePagesDeployment;
  artifactDir: string;
}): Promise<CloudflarePagesArtifactInput> {
  const bytes = await createStaticWebappArtifactBundleBytes(opts.artifactDir);
  const response = await readUploadResponse(
    await fetch(new URL("/api/v1/artifact-uploads/static-webapp", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/vnd.bucknix.static-webapp-artifact+json",
        "x-bnx-submission-id": opts.submissionId,
        ...authHeaders(opts.controlPlaneToken),
      },
      body: bytes,
    }),
  );
  const source = await sourceState(opts.workspaceRoot);
  return {
    kind: "client_upload",
    uploadSessionId: response.uploadSessionId,
    deploymentLabel: opts.deployment.label,
    buildTarget: opts.deployment.component.target,
    sourceRevision: source.sourceRevision,
  };
}
