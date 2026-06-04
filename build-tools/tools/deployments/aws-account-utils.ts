import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getFlagStr, getPositionals, hasFlag } from "../lib/cli";
import type { RunDeps, Subcommand } from "./aws-account-types";

const execFileAsync = promisify(execFile);

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function defaultStackConfigPath(cwd: string): string {
  return path.resolve(cwd, "config", "control-plane", "stack.json");
}

export function renderStackConfigFile(values: Record<string, unknown>): string {
  return `${JSON.stringify({ schemaVersion: "aws-account-stack-config@1", ...values }, null, 2)}\n`;
}

export function relativePath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

export async function writeEvidence(filePath: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readConfigFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fsp.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("aws account config must be an object");
  return parsed as Record<string, unknown>;
}

export function assertNoOperatorSupabasePlanInput(fromFile: Record<string, unknown>): void {
  if (getFlagStr("supabase-plan", "").trim() || Object.hasOwn(fromFile, "supabasePlan")) {
    throw new Error(
      "supabasePlan is not a stack config input. The aws-account command reads the Supabase plan from the Supabase Management API and records it as evidence.",
    );
  }
}

export function assertNoSupabaseAccessTokenRefCliInputs(): void {
  if (hasFlag("supabase-access-token-ref") || hasFlag("supabase-access-token-ref-category")) {
    throw new Error(
      "supabaseAccessTokenRef CLI inputs are no longer supported. Use supabaseAccessToken in stack config with a structured secret ref, or use SUPABASE_ACCESS_TOKEN as a setup-shell fallback.",
    );
  }
}

export function selectedSubcommand(): Subcommand {
  const [, subcommand = "bootstrap"] = getPositionals();
  if (
    ["bootstrap", "status", "resume", "check", "evidence", "clean", "config-init"].includes(
      subcommand,
    )
  ) {
    return subcommand as Subcommand;
  }
  throw new Error(
    "usage: control-plane aws-account <bootstrap|status|resume|check|evidence|clean|config-init>",
  );
}

export function strFlag(name: string, fallback: string): string {
  return getFlagStr(name, fallback).trim();
}

export function sanitizeStateName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .slice(0, 27);
}

export function stringValue(obj: Record<string, unknown>, key: string, fallback: string): string {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function supabasePlanSupportsPrivateLink(plan: string): boolean {
  return /^(team|enterprise)$/i.test(plan.trim());
}

export function summarizeSupabaseProject(
  project: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ref: firstString(project, ["ref", "project_ref"]),
    id: firstString(project, ["id"]),
    name: firstString(project, ["name"]),
    region: firstString(project, ["region", "db_region", "cloud_region"]),
    status: firstString(project, ["status"]),
    organizationId: firstString(project, ["organization_id", "org_id"]),
    organizationSlug: firstString(project, ["organization_slug"]),
  };
}

export function summarizeSupabaseOrganization(
  org: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: firstString(org, ["id"]),
    slug: firstString(org, ["slug"]),
    name: firstString(org, ["name"]),
    plan: firstString(org, ["plan"]),
  };
}

export async function defaultCommandRunner(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const result = await execFileAsync(file, args, { encoding: "utf8", ...options });
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

export function isoNow(deps: RunDeps): string {
  return (deps.now ? deps.now() : new Date()).toISOString();
}

export function printJson(value: unknown, deps: RunDeps): void {
  (deps.stdout || console.log)(JSON.stringify(value, null, 2));
}

export function printUsage(stdout = console.log) {
  stdout(
    [
      "usage: control-plane aws-account <bootstrap|status|resume|check|evidence|clean|config-init>",
      "",
      "defaults: --stack control --region us-east-1 --service deploy --auth-service auth --private-db-service db",
      "canonical config: config/control-plane/stack.json",
      "normal first run:",
      "  control-plane aws-account config-init [--domain <domain>]",
      "  sprinkleref --init-local",
      "  fill local non-secret coordinates in config/sprinkleref/local/values.json or store them in the selected/default resolver",
      "  sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing",
      "  control-plane aws-account check",
      "required coordinates: domain, awsAccountId, awsOrganizationId, supabaseOrgId, supabaseProjectRef",
      "structured refs: stack config can point to config:// or secret:// refs",
      "sources: stack config, config/sprinkleref/local/values.json, or the selected/default resolver",
      "token: write the Supabase Management API token with sprinkleref --update; do not use token write commands for awsOrganizationId",
    ].join("\n"),
  );
}
