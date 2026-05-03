#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { DeploymentTarget } from "./contract-types.ts";

export const OPENTOFU_STACK_PROVISIONER = "opentofu-stack";

export type OpenTofuProvisionerMetadata = {
  type: typeof OPENTOFU_STACK_PROVISIONER;
  config: string;
  stackDirectory: string;
  stackIdentity: string;
  stateBackendIdentity: string;
  allowedEnvironmentDifferences: string[];
};

export type OpenTofuPlanMutationClass = "no_op" | "non_destructive";

export type OpenTofuPlanSummary = {
  mutationClass: OpenTofuPlanMutationClass;
  resourceChangeCount: number;
  actions: string[];
};

const SAFE_ACTIONS = new Set(["no-op", "create", "read", "update"]);

function staysUnder(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function fingerprint(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(String)
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export function classifyOpenTofuPlan(plan: unknown): OpenTofuPlanSummary {
  const changes = Array.isArray((plan as { resource_changes?: unknown })?.resource_changes)
    ? ((plan as { resource_changes: unknown[] }).resource_changes as Record<string, unknown>[])
    : [];
  const actionKeys = new Set<string>();
  for (const change of changes) {
    const actions = asStringList((change.change as { actions?: unknown } | undefined)?.actions);
    if (actions.length === 0)
      throw new Error("opentofu plan contains a resource change with no actions");
    for (const action of actions) {
      if (!SAFE_ACTIONS.has(action))
        throw new Error(`opentofu plan action "${action}" is not safe`);
      actionKeys.add(action);
    }
  }
  const actions = Array.from(actionKeys).sort();
  return {
    mutationClass:
      actions.length === 0 || actions.every((action) => action === "no-op")
        ? "no_op"
        : "non_destructive",
    resourceChangeCount: changes.length,
    actions,
  };
}

export async function readOpenTofuResolvedPlan(opts: {
  workspaceRoot: string;
  packagePath: string;
  provisioner: OpenTofuProvisionerMetadata;
}) {
  const configPath = path.join(opts.workspaceRoot, opts.packagePath, opts.provisioner.config);
  const config = JSON.parse(await fsp.readFile(configPath, "utf8")) as Record<string, unknown>;
  const planJson = String(config.plan_json || config.planJson || "").trim();
  if (!planJson) throw new Error(`opentofu stack config must declare plan_json: ${configPath}`);
  const planPath = path.resolve(path.dirname(configPath), planJson);
  if (staysUnder(planPath, path.join(opts.workspaceRoot, opts.packagePath, "opentofu"))) {
    const plan = JSON.parse(await fsp.readFile(planPath, "utf8"));
    return {
      configPath,
      planPath,
      stackConfigFingerprint: fingerprint(config),
      planFingerprint: fingerprint(plan),
      summary: classifyOpenTofuPlan(plan),
    };
  }
  throw new Error(
    `opentofu plan_json must stay under the deployment opentofu directory: ${planJson}`,
  );
}

export function opentofuPromotionCompatibilityErrors(
  deployment: DeploymentTarget,
  sourceDeployment: DeploymentTarget,
): string[] {
  const current = "provisioner" in deployment ? deployment.provisioner : undefined;
  const source = "provisioner" in sourceDeployment ? sourceDeployment.provisioner : undefined;
  if (current?.type !== OPENTOFU_STACK_PROVISIONER || source?.type !== OPENTOFU_STACK_PROVISIONER) {
    return [];
  }
  const errors: string[] = [];
  const allowed = new Set(current.allowedEnvironmentDifferences || []);
  if (current.stackDirectory !== source.stackDirectory) {
    errors.push(
      `opentofu stack directory mismatch: current=${current.stackDirectory} source=${source.stackDirectory}`,
    );
  }
  if (!allowed.has("stack_identity") && current.stackIdentity !== source.stackIdentity) {
    errors.push(
      `opentofu stack identity mismatch: current=${current.stackIdentity} source=${source.stackIdentity}`,
    );
  }
  if (
    !allowed.has("state_backend_identity") &&
    current.stateBackendIdentity !== source.stateBackendIdentity
  ) {
    errors.push(
      `opentofu state backend mismatch: current=${current.stateBackendIdentity} source=${source.stateBackendIdentity}`,
    );
  }
  return errors;
}
