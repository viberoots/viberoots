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
  await writeJson(path.join(tmp, "projects/config/control-plane/stack.json"), {
    schemaVersion: "aws-account-stack-config@1",
    ...fields,
  });
}

export async function writeLocalValues(tmp: string, values: Record<string, unknown>) {
  await writeJson(path.join(tmp, "projects/config/local.json"), {
    schemaVersion: "viberoots-project-local-config@1",
    values,
  });
}

export async function writeRemote(tmp: string, category: string, values: Record<string, string>) {
  await writeJson(path.join(tmp, "projects/config/shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory: category,
      categories: {
        [category]: { backend: "local-file", file: path.join(tmp, `.local/${category}.json`) },
      },
    },
  });
  await writeJson(path.join(tmp, `.local/${category}.json`), values);
}

export async function writeResolver(
  tmp: string,
  defaultCategory: string,
  stores: Record<string, Record<string, string>>,
) {
  const categories: Record<string, { backend: "local-file"; file: string }> = {};
  for (const [category, values] of Object.entries(stores)) {
    categories[category] = {
      backend: "local-file",
      file: path.join(tmp, `.local/${category}.json`),
    };
    await writeJson(path.join(tmp, `.local/${category}.json`), values);
  }
  await writeJson(path.join(tmp, "projects/config/shared.json"), {
    schemaVersion: "viberoots-project-config@1",
    sprinkleref: {
      version: 1,
      defaultCategory,
      categories,
    },
  });
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

export async function readInputsEvidence(evidenceDir: string) {
  return JSON.parse(await fsp.readFile(path.join(evidenceDir, "inputs.json"), "utf8"));
}

export function assertAccountLocalValuesSource(source: Record<string, unknown>) {
  assert.equal(source.source, "local-values");
  assert.equal(source.ref, "config://control-plane/aws/account-id");
  assert.equal(source.localValuesEntryPath, "values.control-plane.aws.account-id");
  assert.equal(source.valuePrinted, true);
}

export async function runAwsAccountCheckForEvidence(tmp: string, evidenceDir: string) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await withControlPlaneArgv(["aws-account", "check", "--evidence-dir", evidenceDir], async () =>
      runAwsAccountCommand({
        cwd: tmp,
        env: { SUPABASE_ACCESS_TOKEN: "test-token" },
        now: () => new Date("2026-06-02T12:00:00.000Z"),
        httpFetch: fakeSupabaseFetch,
        stdout: () => undefined,
        toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
        commandRunner: async () => ({
          stdout: JSON.stringify({ Account: "123456789012" }),
          stderr: "",
        }),
      }),
    );
  } finally {
    process.exitCode = previousExitCode;
  }
}

export async function fakeSupabaseFetch(url: string) {
  const body = url.includes("/organizations/")
    ? { id: "supabase-org", plan: "Team" }
    : { ref: "project-ref", region: "us-east-1", organization_id: "supabase-org" };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

export async function runCheckForMissingToken(tmp: string): Promise<string> {
  const out: string[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await withControlPlaneArgv(
      ["aws-account", "check", "--evidence-dir", path.join(tmp, "evidence-missing-token")],
      () =>
        runAwsAccountCommand({
          cwd: tmp,
          env: {},
          now: () => new Date("2026-06-02T12:00:00.000Z"),
          stdout: (text) => out.push(text),
          toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
          commandRunner: async () => ({
            stdout: JSON.stringify({ Account: "123456789012" }),
            stderr: "",
          }),
        }),
    );
    assert.equal(process.exitCode, 2);
    return out.join("\n");
  } finally {
    process.exitCode = previousExitCode;
  }
}
