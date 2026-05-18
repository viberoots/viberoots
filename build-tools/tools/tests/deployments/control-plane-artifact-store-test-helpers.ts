#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function memoryControlPlaneArtifactStore() {
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();
  return {
    kind: "s3-compatible" as const,
    bucket: "deploy-artifacts",
    objects,
    putObject: async ({
      key,
      body,
      contentType,
      metadata,
    }: {
      key: string;
      body: Buffer;
      contentType: string;
      metadata?: Record<string, string>;
    }) => {
      objects.set(key, { body: Buffer.from(body), contentType, metadata: { ...(metadata || {}) } });
    },
    getObject: async ({ key }: { key: string }) => {
      const value = objects.get(key);
      if (!value) throw new Error(`missing fake object: ${key}`);
      return Buffer.from(value.body);
    },
    getObjectMetadata: async ({ key }: { key: string }) => {
      const value = objects.get(key);
      if (!value) throw new Error(`missing fake object: ${key}`);
      return { contentType: value.contentType, metadata: { ...value.metadata } };
    },
  };
}

export async function tmpControlPlaneDirs(prefix = "vbr-control-plane-") {
  return new Set((await fsp.readdir(os.tmpdir())).filter((entry) => entry.startsWith(prefix)));
}

export async function tmpControlPlaneDirsForSubmission(
  submissionId: string,
  prefix = "vbr-control-plane-",
) {
  const matches = new Set<string>();
  for (const entry of await tmpControlPlaneDirs(prefix)) {
    try {
      const submission = JSON.parse(
        await fsp.readFile(path.join(os.tmpdir(), entry, "submission.json"), "utf8"),
      ) as { submissionId?: string };
      if (submission.submissionId === submissionId) matches.add(entry);
    } catch {
      continue;
    }
  }
  return matches;
}
