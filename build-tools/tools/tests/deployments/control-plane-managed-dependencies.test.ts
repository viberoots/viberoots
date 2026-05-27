#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  parseManagedDependencyProfile,
  readManagedDependencyCredential,
} from "../../deployments/control-plane-managed-dependency-profiles";
import {
  validateManagedArtifactStoreProfile,
  validateManagedPostgresProfile,
} from "../../deployments/control-plane-managed-dependency-validation";
import type { ControlPlaneManagedDependencyProfile } from "../../deployments/control-plane-managed-dependency-types";
import {
  liveArtifactProfile,
  livePlaceholderArtifactStore,
  requireLiveEnv,
} from "./control-plane-managed-dependencies.live-helpers";

async function withScratch(name: string, fn: (tmp: string) => Promise<void>) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    await fn(tmp);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

async function writeCredentials(root: string, endpoint: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "database-url"), "postgres://user:secret@db/app");
  await fsp.writeFile(path.join(root, "artifact-endpoint"), endpoint);
  await fsp.writeFile(path.join(root, "artifact-access-key"), "file-access-key");
  await fsp.writeFile(path.join(root, "artifact-secret-key"), "file-secret-key");
}

function profileYaml(credentials: string, evidenceFile = "evidence/managed.json") {
  return `
profileName: supabase-and-r2-review
compatibilityEvidenceFile: ${evidenceFile}
postgres:
  provider: supabase-postgres
  urlFile: ${credentials}/database-url
artifactStore:
  provider: cloudflare-r2
  bucket: deploy-artifacts
  region: auto
  endpointFile: ${credentials}/artifact-endpoint
  accessKeyIdFile: ${credentials}/artifact-access-key
  secretAccessKeyFile: ${credentials}/artifact-secret-key
  keyPrefix: tmp/vbr-control-plane
`;
}

async function withFakeS3(
  opts: { region?: string; bucket?: string; omitMetadata?: boolean } = {},
  fn: (endpoint: string) => Promise<void>,
) {
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; metadata: Record<string, string> }
  >();
  const bucket = opts.bucket || "deploy-artifacts";
  const region = opts.region || "auto";
  const server = http.createServer(async (req, res) => {
    if (!String(req.headers.authorization || "").includes(`/${region}/s3/aws4_request`)) {
      res.writeHead(403).end("wrong signing region");
      return;
    }
    const key = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    if (!key.startsWith(`/${bucket}/`)) {
      res.writeHead(404).end("wrong bucket");
      return;
    }
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, {
        body: Buffer.concat(chunks),
        contentType: String(req.headers["content-type"] || ""),
        metadata: Object.fromEntries(
          Object.entries(req.headers)
            .filter(([name]) => name.startsWith("x-amz-meta-"))
            .map(([name, value]) => [name, String(value || "")]),
        ),
      });
      res.writeHead(200).end();
      return;
    }
    const value = objects.get(key);
    if (!value) {
      res.writeHead(404).end("missing");
      return;
    }
    const headers = {
      "content-type": value.contentType,
      ...(opts.omitMetadata ? {} : value.metadata),
    };
    res.writeHead(200, headers).end(req.method === "HEAD" ? undefined : value.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("managed dependency profile parses file-backed Supabase Postgres and S3 candidates", async () => {
  await withScratch("managed-dependency-profile", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    const profile = parseManagedDependencyProfile(profileYaml(credentials), {
      credentialDirectory: credentials,
      baseDir: tmp,
    });
    assert.equal(profile.postgres.provider, "supabase-postgres");
    assert.equal(profile.artifactStore.provider, "cloudflare-r2");
    assert.equal(profile.compatibilityEvidenceFile, path.join(tmp, "evidence/managed.json"));
    assert.throws(
      () =>
        parseManagedDependencyProfile(
          profileYaml(credentials).replace(`${credentials}/`, "/tmp/"),
          {
            credentialDirectory: credentials,
          },
        ),
      /under credential directory/,
    );
  });
});

test("managed artifact-store profile records evidence without credential values", async () => {
  await withFakeS3({}, async (endpoint) => {
    await withScratch("managed-artifact-store-profile", async (tmp) => {
      const credentials = path.join(tmp, "credentials");
      await writeCredentials(credentials, endpoint);
      const profile = parseManagedDependencyProfile(profileYaml(credentials), {
        credentialDirectory: credentials,
        baseDir: tmp,
      });
      const evidence = await validateManagedArtifactStoreProfile(profile);
      assert.equal(evidence.provider, "cloudflare-r2");
      assert.equal(evidence.endpointHost, new URL(endpoint).host);
      assert.ok(!JSON.stringify(evidence).includes("file-secret-key"));
      assert.ok(evidence.checkedOperations.includes("HEAD"));
    });
  });
});

test("managed artifact-store validation fails for region, bucket, metadata, and credentials", async () => {
  await withFakeS3({ region: "us-test-1" }, async (endpoint) => {
    await assert.rejects(() => validateArtifactProfile(endpoint), /wrong signing region/);
  });
  await withFakeS3({ bucket: "other-bucket" }, async (endpoint) => {
    await assert.rejects(() => validateArtifactProfile(endpoint), /wrong bucket/);
  });
  await withFakeS3({ omitMetadata: true }, async (endpoint) => {
    await assert.rejects(() => validateArtifactProfile(endpoint), /metadata mismatch/);
  });
  await assert.rejects(
    () => readManagedDependencyCredential("/tmp/vbr-missing-managed-secret"),
    (error: any) => !String(error?.message || error).includes("file-secret-key"),
  );
});

async function validateArtifactProfile(endpoint: string) {
  await withScratch("managed-artifact-store-negative", async (tmp) => {
    const credentials = path.join(tmp, "credentials");
    await writeCredentials(credentials, endpoint);
    const profile: ControlPlaneManagedDependencyProfile = parseManagedDependencyProfile(
      profileYaml(credentials),
      { credentialDirectory: credentials, baseDir: tmp },
    );
    await validateManagedArtifactStoreProfile(profile);
  });
}

test("live-gated Supabase Postgres conformance validates Supabase provider explicitly", async (t) => {
  const env = requireLiveEnv(t, "VBR_SUPABASE_POSTGRES_LIVE_CONFORMANCE", [
    "VBR_SUPABASE_POSTGRES_LIVE_DATABASE_URL_FILE",
  ]);
  if (!env.VBR_SUPABASE_POSTGRES_LIVE_DATABASE_URL_FILE) return;
  const result = await validateManagedPostgresProfile({
    profileName: "live-supabase-postgres",
    postgres: {
      provider: "supabase-postgres",
      urlFile: env.VBR_SUPABASE_POSTGRES_LIVE_DATABASE_URL_FILE,
    },
    artifactStore: livePlaceholderArtifactStore(),
  });
  assert.equal(result.provider, "supabase-postgres");
});

test("live-gated Supabase Storage S3 conformance validates Supabase provider explicitly", async (t) => {
  const profile = liveArtifactProfile(t, "supabase-storage-s3", {
    enabledFlag: "VBR_SUPABASE_STORAGE_S3_LIVE_CONFORMANCE",
    envPrefix: "VBR_SUPABASE_STORAGE_S3_LIVE",
  });
  if (!profile) return;
  const result = await validateManagedArtifactStoreProfile(profile);
  assert.equal(result.provider, "supabase-storage-s3");
});

test("live-gated Cloudflare R2 conformance validates R2 comparison provider explicitly", async (t) => {
  const profile = liveArtifactProfile(t, "cloudflare-r2", {
    enabledFlag: "VBR_CLOUDFLARE_R2_LIVE_CONFORMANCE",
    envPrefix: "VBR_CLOUDFLARE_R2_LIVE",
  });
  if (!profile) return;
  const result = await validateManagedArtifactStoreProfile(profile);
  assert.equal(result.provider, "cloudflare-r2");
});
