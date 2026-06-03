import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readAwsAccountConfig, runAwsAccountCommand } from "../../deployments/aws-account";
import { parseStackField, resolveStackRef } from "../../deployments/aws-account-inputs";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import { runInTemp } from "../lib/test-helpers";
import { withControlPlaneArgv } from "./control-plane-process-entrypoints.helpers";

export {
  assert,
  fsp,
  parseStackField,
  path,
  readAwsAccountConfig,
  resolveStackRef,
  runAwsAccountCommand,
  runInTemp,
  runSprinkleRefCli,
  test,
  withControlPlaneArgv,
};

export async function writeStack(tmp: string, fields: Record<string, unknown>) {
  await writeJson(path.join(tmp, "config/control-plane/stack.json"), {
    schemaVersion: "aws-account-stack-config@1",
    ...fields,
  });
}

export async function writeLocalValues(tmp: string, values: Record<string, unknown>) {
  await writeJson(path.join(tmp, "config/sprinkleref/local/values.json"), {
    schemaVersion: "sprinkleref-values@1",
    values,
  });
}

export async function writeRemote(tmp: string, category: string, values: Record<string, string>) {
  await writeJson(path.join(tmp, "config/sprinkleref/selected.json"), {
    version: 1,
    defaultCategory: category,
    categories: {
      [category]: { backend: "local-file", file: path.join(tmp, `.local/${category}.json`) },
    },
  });
  await writeJson(path.join(tmp, `.local/${category}.json`), values);
}

export async function writeJson(file: string, value: unknown) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readSupabaseEvidence(evidenceDir: string) {
  return JSON.parse(
    await fsp.readFile(path.join(evidenceDir, "check-supabase/supabase-readiness.json"), "utf8"),
  );
}

export async function fakeSupabaseFetch(url: string) {
  const body = url.includes("/organizations/")
    ? { id: "supabase-org", plan: "Team" }
    : { ref: "project-ref", region: "us-east-1", organization_id: "supabase-org" };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}
