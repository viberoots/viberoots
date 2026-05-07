#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import {
  redactOperatorText,
  type DeploymentOperatorVisiblePayload,
} from "./deployment-control-plane-redaction";

export const FOUNDATION_MIGRATION_OUTCOME_SCHEMA = "foundation-migration-outcome@1";
export const FOUNDATION_POST_APPLY_CHECKS = [
  "rls_tenant_isolation",
  "composite_tenant_fk",
  "migration_ordering",
  "required_extension_settings",
] as const;

export type FoundationPostApplyCheckName = (typeof FOUNDATION_POST_APPLY_CHECKS)[number];
export type FoundationPostApplyCheck = {
  name: FoundationPostApplyCheckName;
  status: "passed" | "failed";
  diagnostics?: string;
};

export type FoundationMigrationAdapter = {
  apply(opts: {
    bundlePath: string;
    targetSupabaseIdentity: string;
    credentialEnvNames: string[];
    credentialEnv: Record<string, string>;
  }): Promise<{ status: "succeeded" | "failed"; diagnostics?: string }>;
  check(opts: {
    targetSupabaseIdentity: string;
    credentialEnvNames: string[];
    credentialEnv: Record<string, string>;
  }): Promise<FoundationPostApplyCheck[]>;
};

export type FoundationMigrationOutcome = {
  schemaVersion: typeof FOUNDATION_MIGRATION_OUTCOME_SCHEMA;
  status: "succeeded" | "failed";
  bundleIdentity: string;
  migrationList: string[];
  dependencyGraphFingerprint: string;
  targetSupabaseIdentity: string;
  sourceRevision: string;
  credentialEnvNames: string[];
  postApplyChecks: FoundationPostApplyCheck[];
  diagnostics?: DeploymentOperatorVisiblePayload;
};

export { createProductionFoundationMigrationAdapter } from "./foundation-migration-production";

function requireText(name: string, value: string | undefined): string {
  const resolved = String(value || "").trim();
  if (!resolved) throw new Error(`foundation migration missing ${name}`);
  return resolved;
}

async function readBundleManifest(bundlePath: string) {
  const manifestPath = path.join(bundlePath, "manifest.json");
  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  if (manifest.schema_version !== "deployment-migration-bundle@1") {
    throw new Error(`unsupported migration bundle manifest: ${manifestPath}`);
  }
  return manifest;
}

function requiredPostApplyChecks(checks: FoundationPostApplyCheck[]): FoundationPostApplyCheck[] {
  const byName = new Map(checks.map((check) => [check.name, check]));
  return FOUNDATION_POST_APPLY_CHECKS.map(
    (name) =>
      byName.get(name) || {
        name,
        status: "failed",
        diagnostics: `post-apply check did not report required result: ${name}`,
      },
  );
}

export async function runFoundationMigrationApply(opts: {
  bundlePath: string;
  targetSupabaseIdentity: string;
  sourceRevision: string;
  secretRuntime: { enterStep(step: "provision"): Promise<Record<string, string>> };
  adapter: FoundationMigrationAdapter;
}): Promise<FoundationMigrationOutcome> {
  const manifest = await readBundleManifest(opts.bundlePath);
  const targetSupabaseIdentity = requireText(
    "target Supabase identity",
    opts.targetSupabaseIdentity,
  );
  const credentials = await opts.secretRuntime.enterStep("provision");
  const credentialEnvNames = Object.keys(credentials).sort();
  if (!credentialEnvNames.some((name) => name.includes("supabase"))) {
    throw new Error(
      "foundation migration requires Supabase credentials from provision secret_requirements",
    );
  }
  const apply = await opts.adapter.apply({
    bundlePath: opts.bundlePath,
    targetSupabaseIdentity,
    credentialEnvNames,
    credentialEnv: credentials,
  });
  const checks =
    apply.status === "succeeded"
      ? requiredPostApplyChecks(
          await opts.adapter.check({
            targetSupabaseIdentity,
            credentialEnvNames,
            credentialEnv: credentials,
          }),
        )
      : [];
  const failedCheck = checks.find((check) => check.status !== "passed");
  const diagnostics = redactOperatorText(failedCheck?.diagnostics || apply.diagnostics || "");
  return {
    schemaVersion: FOUNDATION_MIGRATION_OUTCOME_SCHEMA,
    status: apply.status === "succeeded" && !failedCheck ? "succeeded" : "failed",
    bundleIdentity: fingerprintValue(manifest),
    migrationList: (manifest.ordered_migration_sets || []).map((entry: any) =>
      String(entry.target),
    ),
    dependencyGraphFingerprint: String(manifest.dependency_graph_fingerprint || ""),
    targetSupabaseIdentity,
    sourceRevision: opts.sourceRevision,
    credentialEnvNames,
    postApplyChecks: checks,
    ...(diagnostics ? { diagnostics } : {}),
  };
}
