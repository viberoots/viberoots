#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export type MiniLiveValidationOptions = {
  baseUrl: string;
  credentialDirectory: string;
  token?: string;
  expectedUid?: number;
  expectedGid?: number;
  credentialNames?: string[];
  fetchImpl?: typeof fetch;
};

const DEFAULT_CREDENTIALS = [
  "control-plane-database-url",
  "control-plane-token",
  "reviewed-source-ssh-key",
  "artifact-store-endpoint",
  "artifact-store-access-key-id",
  "artifact-store-secret-access-key",
];

function authHeaders(token?: string) {
  return token ? { authorization: `Bearer ${token}` } : undefined;
}

export async function validateMiniLiveControlPlane(opts: MiniLiveValidationOptions) {
  const fetcher = opts.fetchImpl || fetch;
  const base = new URL(opts.baseUrl);
  const health = await (await fetcher(new URL("/healthz", base))).json();
  if (!health.ok) throw new Error("mini live validation failed: service health is not ok");
  const heartbeats = await (
    await fetcher(new URL("/api/v1/worker-heartbeats", base), { headers: authHeaders(opts.token) })
  ).json();
  if (!Array.isArray(heartbeats.workers) || heartbeats.workers.length < 1) {
    throw new Error("mini live validation failed: no worker heartbeats");
  }
  const unhealthyWorker = heartbeats.workers.find((worker: any) => worker.status !== "running");
  if (unhealthyWorker) {
    throw new Error(
      `mini live validation failed: worker ${unhealthyWorker.workerId} is not running`,
    );
  }
  for (const name of opts.credentialNames || DEFAULT_CREDENTIALS) {
    const stat = await fsp.stat(path.join(opts.credentialDirectory, name));
    if ((stat.mode & 0o077) !== 0) {
      throw new Error(`mini live validation failed: credential ${name} is group/world readable`);
    }
    if (opts.expectedUid !== undefined && stat.uid !== opts.expectedUid) {
      throw new Error(`mini live validation failed: credential ${name} owner uid mismatch`);
    }
    if (opts.expectedGid !== undefined && stat.gid !== opts.expectedGid) {
      throw new Error(`mini live validation failed: credential ${name} owner gid mismatch`);
    }
  }
  return {
    ok: true,
    workerCount: heartbeats.workers.length,
    credentialCount: DEFAULT_CREDENTIALS.length,
  };
}
