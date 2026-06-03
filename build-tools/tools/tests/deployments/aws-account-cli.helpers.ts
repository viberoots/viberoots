import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { selectedControlPlaneCommand } from "../../deployments/deployment-control-plane-command";
import {
  AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS,
  readAwsAccountConfig,
  runAwsAccountCommand,
} from "../../deployments/aws-account";
import { runInTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

export {
  AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS,
  assert,
  fsp,
  path,
  readAwsAccountConfig,
  runAwsAccountCommand,
  runInTemp,
  selectedControlPlaneCommand,
  test,
  withControlPlaneArgv,
};
export const NOW = new Date("2026-06-02T12:00:00.000Z");

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function removeCanonicalStackConfig(root: string): Promise<void> {
  await fsp.rm(path.join(root, "config", "control-plane"), { recursive: true, force: true });
}

export async function withCwd<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const oldCwd = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(oldCwd);
  }
}

export async function fakeSupabaseFetch(url: string, init?: { headers?: Record<string, string> }) {
  assert.equal(init?.headers?.Authorization, "Bearer test-token");
  const pathName = new URL(url).pathname;
  if (pathName === "/v1/projects/project-ref") {
    return jsonResponse(200, {
      ref: "project-ref",
      name: "Control DB",
      region: "us-east-1",
      status: "ACTIVE_HEALTHY",
      organization_id: "supabase-org",
    });
  }
  if (pathName === "/v1/organizations/supabase-org") {
    return jsonResponse(200, {
      id: "supabase-org",
      name: "Supabase Org",
      plan: "Team",
    });
  }
  return jsonResponse(404, { message: "not found" });
}

function jsonResponse(status: number, value: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  };
}
