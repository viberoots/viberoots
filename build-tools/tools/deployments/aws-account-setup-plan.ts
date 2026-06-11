import path from "node:path";
import { getFlagBool } from "../lib/cli";
import { PROJECT_LOCAL_CONFIG_PATH } from "./project-config";
import { resolveSupabaseAccessToken, tokenSource } from "./aws-account-supabase-token";
import type { AwsAccountConfig, MissingConfigField, RunDeps } from "./aws-account-types";
import { defaultStackConfigPath, pathExists, printJson, relativePath } from "./aws-account-utils";

type SetupStep = {
  category: string;
  title: string;
  action: string;
  ref?: string;
  path?: string;
  command?: string;
};

export async function printSetupPlan(config: AwsAccountConfig, deps: RunDeps): Promise<void> {
  const cwd = deps.cwd || process.cwd();
  const steps: SetupStep[] = [];
  if (!(await pathExists(path.resolve(cwd, PROJECT_LOCAL_CONFIG_PATH)))) {
    steps.push({
      category: "local operator config initialization",
      title: "Initialize local operator config",
      action: "Create the gitignored local config file before filling clone-local values.",
      path: PROJECT_LOCAL_CONFIG_PATH,
      command: "sprinkleref --init-local",
    });
  }
  const tokenSetup = await tokenSetupState(config, deps);
  for (const field of collectMissingSetupFields(config, tokenSetup.missing)) {
    steps.push(stepForMissingField(field));
  }
  if (tokenSetup.runtimeStep) steps.push(tokenSetup.runtimeStep);
  steps.push(...readinessSteps(config));
  const output = {
    schemaVersion: "aws-account-setup-plan@1",
    stackName: config.stackName,
    domain: config.domain,
    readOnly: true,
    steps,
  };
  if (getFlagBool("json")) return printJson(output, deps);
  (deps.stdout || console.log)(formatSetupPlan(config, steps));
}

export async function printSetupPlanWithoutStack(cwd: string, deps: RunDeps): Promise<void> {
  const steps: SetupStep[] = [
    {
      category: "repo config initialization",
      title: "Initialize shared SprinkleRef/project config",
      action: "Ensure the checked-in shared project config exists.",
      path: "projects/config/shared.json",
      command: "sprinkleref --init",
    },
    {
      category: "local operator config initialization",
      title: "Initialize local operator config",
      action: "Create the gitignored local config file for this operator clone.",
      path: PROJECT_LOCAL_CONFIG_PATH,
      command: "sprinkleref --init-local",
    },
    {
      category: "repo config initialization",
      title: "Create the AWS stack config",
      action: "Supply the first control-plane domain and generate the canonical stack file.",
      path: relativePath(cwd, defaultStackConfigPath(cwd)),
      command: "control-plane aws-account config-init --domain <domain>",
    },
  ];
  if (getFlagBool("json")) {
    return printJson({ schemaVersion: "aws-account-setup-plan@1", readOnly: true, steps }, deps);
  }
  (deps.stdout || console.log)(formatSetupPlanHeader(steps));
}

function collectMissingSetupFields(
  config: AwsAccountConfig,
  tokenMissing?: MissingConfigField,
): MissingConfigField[] {
  const fields: MissingConfigField[] = [];
  const add = (field: keyof AwsAccountConfig["inputSources"], value: unknown, hint: string) => {
    if (value) return;
    const source = config.inputSources[field];
    fields.push({
      field,
      valueHint: hint,
      destination:
        source?.source === "local-values" ? "project-local-config" : "project-shared-config",
      ref: source?.ref,
      category: source?.category,
    });
  };
  add("awsAccountId", config.awsAccountId, "<aws-account-id>");
  add("awsOrganizationId", config.awsOrganizationId, "<aws-organization-id>");
  add("supabaseOrgId", config.supabaseOrgId, "<supabase-org-id>");
  add("supabaseProjectRef", config.supabaseProjectRef, "<supabase-project-ref>");
  if (tokenMissing) fields.push(tokenMissing);
  return fields;
}

async function tokenSetupState(
  config: AwsAccountConfig,
  deps: RunDeps,
): Promise<{ missing?: MissingConfigField; runtimeStep?: SetupStep }> {
  const resolution = await resolveSupabaseAccessToken(config, deps);
  const source = tokenSource(resolution.metadata);
  if (resolution.token) {
    if (source.source !== "env") return {};
    return {
      runtimeStep: {
        category: "runtime credential source",
        title: "Use temporary Supabase runtime credential",
        action:
          "The Supabase Management API token is coming from this process environment for this run only; move durable setup to a secret backend.",
        command: `export ${source.env || config.supabaseAccessTokenEnv}=<redacted-token>`,
      },
    };
  }
  return {
    missing: {
      field: "supabaseAccessToken",
      valueHint: "secret value redacted",
      destination:
        source.source === "env"
          ? "stack-config"
          : source.category === "bootstrap" && source.categoryExplicit
            ? "bootstrap-category"
            : "secret-backend",
      ref: source.ref || config.supabaseAccessToken?.ref,
      category: source.category,
      note: `or export ${config.supabaseAccessTokenEnv} for this setup run; do not store token values in JSON`,
    },
  };
}

function stepForMissingField(field: MissingConfigField): SetupStep {
  const ref = field.ref;
  if (field.destination === "project-local-config") {
    return missingStep(field, "local operator config initialization", PROJECT_LOCAL_CONFIG_PATH);
  }
  if (field.destination === "secret-backend" || ref?.startsWith("secret://")) {
    return {
      category: "secret backend write",
      title: `Write ${field.field} to the selected secret backend`,
      action:
        "Store the secret through SprinkleRef or the selected backend; never paste token values into JSON.",
      ref,
      command: ref ? `sprinkleref --update ${ref} --create-missing` : undefined,
    };
  }
  return missingStep(
    field,
    "shared non-secret project config value",
    "projects/config/shared.json",
  );
}

function missingStep(field: MissingConfigField, category: string, pathValue: string): SetupStep {
  return {
    category,
    title: `Set ${field.field}`,
    action: `Add the non-secret value at ${field.ref || field.field}.`,
    ref: field.ref,
    path: pathValue,
  };
}

function readinessSteps(config: AwsAccountConfig): SetupStep[] {
  return [
    {
      category: "AWS login/readiness check",
      title: "Verify AWS login and tool readiness",
      action:
        "Run the read-only readiness check; it records evidence and does not provision cloud resources.",
      command: "control-plane aws-account check",
    },
    {
      category: "Supabase account/project/readiness check",
      title: "Verify Supabase account and project readiness",
      action: `Use ${config.supabaseAccessTokenEnv} only as a temporary runtime credential source when the secret backend is not ready.`,
      command: "control-plane aws-account check",
    },
    {
      category: "reviewed IaC/evidence step",
      title: "Plan reviewed AWS foundation work",
      action:
        "Use reviewed OpenTofu/IaC plan and evidence flows for durable AWS resources; this setup-plan command does not create them.",
      command: "control-plane aws-account bootstrap",
    },
  ];
}

function formatSetupPlan(config: AwsAccountConfig, steps: SetupStep[]): string {
  return [
    "AWS Account Setup Plan",
    "",
    `Stack:    ${config.stackName}`,
    `Domain:   ${config.domain}`,
    `Region:   ${config.region}`,
    "",
    ...formatSetupPlanLines(steps),
  ].join("\n");
}

function formatSetupPlanHeader(steps: SetupStep[]): string {
  return ["AWS Account Setup Plan", "", ...formatSetupPlanLines(steps)].join("\n");
}

function formatSetupPlanLines(steps: SetupStep[]): string[] {
  const lines = [
    "Read-only: this command does not mutate AWS, Supabase, Infisical, Vault, or cloud resources.",
    "",
    "Next Steps",
  ];
  steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. [${step.category}] ${step.title}`, `     ${step.action}`);
    if (step.path) lines.push(`     path: ${step.path}`);
    if (step.ref) lines.push(`     ref: ${step.ref}`);
    if (step.command) lines.push(`     command: ${step.command}`);
  });
  return lines;
}
