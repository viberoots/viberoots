#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import type { FoundationMigrationAdapter, FoundationPostApplyCheck } from "./foundation-migration";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";

const FALLBACK_FAILED_CHECK = "rls_tenant_isolation";

function runtimeBin(): string {
  return String(
    process.env.VBR_SUPABASE_MIGRATION_BIN ||
      process.env.VBR_DEPLOY_SUPABASE_MIGRATION_BIN ||
      "supabase-migration-runtime",
  ).trim();
}

function runRuntime(opts: {
  args: string[];
  credentialEnv: Record<string, string>;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtimeBin(), opts.args, {
      env: scrubControlPlaneChildEnv(opts.credentialEnv),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function parseChecks(stdout: string): FoundationPostApplyCheck[] {
  const parsed = JSON.parse(stdout || "[]");
  if (!Array.isArray(parsed)) throw new Error("post-apply check output must be a JSON array");
  return parsed.map((entry) => ({
    name: entry.name,
    status: entry.status,
    ...(entry.diagnostics ? { diagnostics: String(entry.diagnostics) } : {}),
  }));
}

export function createProductionFoundationMigrationAdapter(): FoundationMigrationAdapter {
  return {
    async apply(opts) {
      const result = await runRuntime({
        args: ["apply", "--bundle", opts.bundlePath, "--target", opts.targetSupabaseIdentity],
        credentialEnv: opts.credentialEnv,
      });
      return {
        status: result.exitCode === 0 ? "succeeded" : "failed",
        diagnostics: result.stderr || result.stdout,
      };
    },
    async check(opts) {
      const result = await runRuntime({
        args: ["check", "--target", opts.targetSupabaseIdentity],
        credentialEnv: opts.credentialEnv,
      });
      if (result.exitCode !== 0) {
        return [
          {
            name: FALLBACK_FAILED_CHECK,
            status: "failed",
            diagnostics: result.stderr || result.stdout,
          },
        ];
      }
      return parseChecks(result.stdout);
    },
  };
}
