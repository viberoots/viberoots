#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { defaultReviewedRuntimeInput } from "../../deployments/cloud-control-runtime-input";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { privateLinkSupabaseProfile } from "./control-plane-supabase-postgres.fixture";

export function withControlPlaneArgv<T>(argv: string[], run: () => Promise<T>): Promise<T> {
  const previous = process.argv;
  const previousGlobal = (globalThis as any).argv;
  process.argv = ["node", "deployment-control-plane.ts", ...argv];
  (globalThis as any).argv = { _: argv.filter((arg) => !arg.startsWith("--")) };
  return run().finally(() => {
    process.argv = previous;
    (globalThis as any).argv = previousGlobal;
  });
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("failed to allocate test port");
  return address.port;
}

export async function writeRuntimeConfig(
  tmp: string,
  opts: { port?: number; omit?: string[]; processMode?: string } = {},
) {
  const credentials = await fsp.mkdtemp(path.join(os.tmpdir(), "control-plane-creds-"));
  const runtimeRoot = path.join(tmp, "runtime");
  const recordsRoot = path.join(tmp, "records");
  const artifactRoot = path.join(tmp, "artifacts");
  await fsp.mkdir(tmp, { recursive: true });
  await fsp.mkdir(credentials, { recursive: true });
  const files = {
    db: path.join(credentials, "control-plane-database-url"),
    token: path.join(credentials, "control-plane-token"),
    endpoint: path.join(credentials, "artifact-store-endpoint"),
    access: path.join(credentials, "artifact-store-access-key-id"),
    secret: path.join(credentials, "artifact-store-secret-access-key"),
    ssh: path.join(credentials, "reviewed-source-ssh-key"),
    knownHosts: path.join(credentials, "reviewed-source-known-hosts"),
  };
  const omitted = new Set(opts.omit || []);
  for (const [name, filePath] of Object.entries(files)) {
    if (!omitted.has(name)) await fsp.writeFile(filePath, `${name}-value\n`, "utf8");
  }
  if (!omitted.has("db")) {
    await fsp.writeFile(files.db, `${localHarnessControlPlaneDatabaseUrl(recordsRoot)}\n`, "utf8");
  }
  if (!omitted.has("endpoint")) {
    await fsp.writeFile(files.endpoint, "http://127.0.0.1:9\n", "utf8");
  }
  const configPath = path.join(tmp, "control-plane.yaml");
  await fsp.writeFile(
    configPath,
    [
      "instanceId: test-instance",
      `processMode: ${opts.processMode || "fully-enabled"}`,
      "service:",
      "  host: 127.0.0.1",
      `  port: ${opts.port || (await availablePort())}`,
      "  publicUrl: http://127.0.0.1",
      `  tokenFile: ${files.token}`,
      "storage:",
      `  recordsRoot: ${recordsRoot}`,
      `  artifactStagingRoot: ${artifactRoot}`,
      `  runtimeRoot: ${runtimeRoot}`,
      "  artifactStore:",
      "    kind: s3-compatible",
      "    bucket: deploy-artifacts",
      "    region: auto",
      `    endpointFile: ${files.endpoint}`,
      `    accessKeyIdFile: ${files.access}`,
      `    secretAccessKeyFile: ${files.secret}`,
      "database:",
      `  urlFile: ${files.db}`,
      "credentials:",
      `  directory: ${credentials}`,
      "reviewedSource:",
      `  sshKeyFile: ${files.ssh}`,
      `  sshKnownHostsFile: ${files.knownHosts}`,
      "",
    ].join("\n"),
    "utf8",
  );
  return { configPath, recordsRoot };
}

export async function supabaseProfileArgs(tmp: string): Promise<string[]> {
  const file = path.join(tmp, "supabase-postgres.profile.json");
  await fsp.writeFile(file, JSON.stringify(privateLinkSupabaseProfile()), "utf8");
  return ["--supabase-postgres-profile", file];
}

export async function runtimeInputArgs(tmp: string): Promise<string[]> {
  const file = path.join(tmp, "runtime-input.yaml");
  await fsp.writeFile(
    file,
    YAML.stringify(
      defaultReviewedRuntimeInput({
        publicUrl: "https://deploy.example.test",
        authCallbackHost: "deploy-auth.example.test",
        authCallbackPath: "/oidc/callback",
        deploymentIds: ["cloud-control-fixture-staging"],
        supabaseProjectRef: "project-review",
        supabaseConnectionMode: "privatelink",
        awsAccountId: "123456789012",
        awsRegion: "us-east-1",
        awsVpcId: "vpc-123",
        artifactCredentialMode: "files",
      }),
    ),
    "utf8",
  );
  return ["--runtime-input", file];
}
