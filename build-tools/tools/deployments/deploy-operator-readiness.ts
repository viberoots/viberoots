import path from "node:path";
import type { DeploymentTarget } from "./contract";
import { readAwsAccountConfig } from "./aws-account-config-read";
import { collectMissingConfigFields, phaseStateLabel } from "./aws-account-output-parts";
import { readStatus } from "./aws-account-status";
import { PHASES, type AwsAccountStatus } from "./aws-account-types";
import { selectedDeployControlPlaneOperatorAction } from "./deploy-control-plane-operator-flags";
import { readProjectConfigSync } from "./project-config";

export async function maybeRunDeployOperatorReadinessCommand(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
}): Promise<boolean> {
  if (selectedDeployControlPlaneOperatorAction() !== "operator-readiness") return false;
  console.log(await formatDeployOperatorReadiness(opts));
  return true;
}

type RuntimeBindingStatus = {
  state: "present" | "missing" | "binding-missing" | "not-runtime";
  envName?: string;
  message: string;
};

export async function formatDeployOperatorReadiness(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const env = opts.env || process.env;
  const deployment = opts.deployment;
  const tokenRef = deployment.controlPlane?.serviceClient.controlPlaneTokenRef || "";
  const lines = [
    "Deployment Operator Readiness",
    "",
    "Selection",
    `  deployment: ${deployment.label}`,
    `  deploymentId: ${deployment.deploymentId}`,
    `  stage: ${deployment.environmentStage}`,
    `  provider: ${deployment.provider}`,
    `  protection: ${deployment.protectionClass}`,
    `  context: ${deployment.deploymentContext?.name || "(none)"}`,
    `  controlPlane: ${deployment.controlPlane?.name || "(none)"}`,
    `  controlPlaneUrl: ${deployment.controlPlane?.serviceClient.controlPlaneUrl || "(none)"}`,
    `  controlPlaneTokenRef: ${tokenRef || "(none)"}`,
    `  secretBackend: ${secretBackendLabel(deployment)}`,
    "",
    "Credentials",
    ...credentialLines(opts.workspaceRoot, tokenRef, env),
    "",
    "AWS Account Readiness",
    ...(await awsReadinessLines(opts.workspaceRoot)),
    "",
    "Next",
    `  deploy --deployment ${deployment.label} --operator-readiness`,
    "  control-plane aws-account setup-plan",
    "  control-plane aws-account check",
    `  deploy --deployment ${deployment.label} --validate-only`,
  ];
  return lines.join("\n");
}

function secretBackendLabel(deployment: DeploymentTarget): string {
  if (!deployment.secretBackend) return "(none)";
  return deployment.secretBackendProfile
    ? `${deployment.secretBackend}/${deployment.secretBackendProfile}`
    : deployment.secretBackend;
}

function credentialLines(
  workspaceRoot: string,
  tokenRef: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (!tokenRef) return ["  control-plane token: missing selected controlPlaneTokenRef"];
  if (tokenRef.startsWith("secret://")) {
    return [
      "  control-plane token: selected secret backend credential ref",
      `  remediation: sprinkleref --update ${tokenRef} --create-missing`,
    ];
  }
  const runtime = runtimeBindingStatus(workspaceRoot, tokenRef, env);
  return [
    `  control-plane token: ${runtime.message}`,
    ...(runtime.envName ? [`  runtime env: ${runtime.envName}`] : []),
  ];
}

function runtimeBindingStatus(
  workspaceRoot: string,
  tokenRef: string,
  env: NodeJS.ProcessEnv,
): RuntimeBindingStatus {
  if (!tokenRef.startsWith("runtime://")) {
    return { state: "not-runtime", message: "unsupported token ref scheme" };
  }
  const parsed = parseRuntimeRef(tokenRef);
  if (!parsed) {
    return { state: "binding-missing", message: "runtime credential ref is malformed" };
  }
  const config = readProjectConfigSync(workspaceRoot).config;
  const host = recordAt(config.runtimeHosts, parsed.host);
  const binding = recordAt(host?.bindings, parsed.binding);
  const envName = typeof binding?.name === "string" ? binding.name.trim() : "";
  if (!envName || binding.kind !== "env") {
    return {
      state: "binding-missing",
      message: `runtime binding ${parsed.host}/${parsed.binding} is missing or not kind env`,
    };
  }
  return String(env[envName] || "").trim()
    ? { state: "present", envName, message: "runtime credential binding is present" }
    : { state: "missing", envName, message: "runtime credential binding is missing" };
}

function parseRuntimeRef(tokenRef: string): { host: string; binding: string } | undefined {
  const [host, ...bindingParts] = tokenRef.slice("runtime://".length).split("/").filter(Boolean);
  const binding = bindingParts.join("/");
  return host && binding ? { host, binding } : undefined;
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (!key) return value as Record<string, unknown>;
  const entry = (value as Record<string, unknown>)[key];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : undefined;
}

async function awsReadinessLines(workspaceRoot: string): Promise<string[]> {
  try {
    const config = await readAwsAccountConfig(workspaceRoot);
    const missing = ["awsAccountId", "awsOrganizationId", "supabaseOrgId", "supabaseProjectRef"]
      .filter((field) => !config[field as keyof typeof config])
      .concat(Object.keys(config.inputErrors));
    let status: AwsAccountStatus | undefined;
    try {
      status = await readStatus(config);
    } catch {
      status = undefined;
    }
    return [
      `  stack: ${config.stackName}`,
      `  domain: ${config.domain}`,
      `  evidence: ${path.join(config.evidenceDir, "status.json")}`,
      ...(missing.length ? [`  missing config: ${[...new Set(missing)].join(", ")}`] : []),
      ...(status ? statusLines(status) : ["  status: not run"]),
    ];
  } catch (error) {
    return [
      "  status: not initialized",
      `  diagnostic: ${redact(String(error instanceof Error ? error.message : error))}`,
      "  remediation: control-plane aws-account config-init --domain <domain>",
    ];
  }
}

function statusLines(status: AwsAccountStatus): string[] {
  const lines = PHASES.filter((phase) => status.phases[phase]?.state !== "pending").map(
    (phase) => `  ${phaseStateLabel(status.phases[phase].state).padEnd(7)} ${phase}`,
  );
  const cache = status.phases["check-tools"]?.cacheReadiness;
  if (cache) lines.push(`  cache: ${cache.state} (${cache.policy})`);
  const problemPhases = PHASES.filter((phase) =>
    ["blocked", "failed"].includes(status.phases[phase]?.state || ""),
  );
  const missing = collectMissingConfigFields(problemPhases, status)
    .map((field) => field.field)
    .filter(Boolean);
  if (missing.length) lines.push(`  missing values: ${[...new Set(missing)].join(", ")}`);
  if (status.nextPhase) lines.push(`  next phase: ${status.nextPhase}`);
  return lines.length ? lines : ["  status: pending"];
}

function redact(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer (redacted)")
    .replace(
      /\b(token|secret|password|client[_-]?secret)\b\s*[:=](?!\/\/)\s*\S+/gi,
      "$1=(redacted)",
    );
}
