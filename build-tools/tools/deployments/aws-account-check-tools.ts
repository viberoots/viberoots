import path from "node:path";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { CONTROL_PLANE_CONFIG_REFS } from "./aws-account-ref-schemes";
import type {
  AwsAccountConfig,
  MissingConfigField,
  PhaseRecord,
  RunDeps,
} from "./aws-account-types";
import { defaultCommandRunner, writeEvidence } from "./aws-account-utils";

export async function checkTools(
  config: AwsAccountConfig,
  deps: RunDeps,
  now: string,
): Promise<PhaseRecord> {
  const tools = ["aws", "tofu", "dig", "openssl", "psql", "jq", "node", "pnpm"];
  const resolved: Record<string, string> = {};
  const errors: string[] = [];
  for (const tool of tools) {
    try {
      resolved[tool] = (deps.toolResolver || ensureNixStoreToolPathSync)(tool);
    } catch (error) {
      errors.push(String(error instanceof Error ? error.message : error));
    }
  }
  const evidence = path.join(config.evidenceDir, "check-tools", "tools.json");
  await writeEvidence(evidence, {
    schemaVersion: "aws-account-tools@1",
    checkedAt: now,
    resolved,
    errors,
  });
  return {
    state: errors.length > 0 ? "failed" : "passed",
    message:
      errors.length > 0
        ? `required flake-provided tools are missing or not from /nix/store: ${errors.join("; ")}`
        : "all required tools resolve from the repo Nix environment",
    evidence,
    checkedAt: now,
  };
}

export async function checkAwsLogin(
  config: AwsAccountConfig,
  deps: RunDeps,
  now: string,
): Promise<PhaseRecord> {
  const missingConfigFields = missingAwsIdentityFields(config);
  if (missingConfigFields.length > 0) {
    const errors = missingConfigFields
      .map((field) => config.inputErrors[field.field])
      .filter(Boolean);
    return {
      state: "blocked",
      message: `AWS identity coordinates are missing: ${missingConfigFields
        .map((field) => field.field)
        .join(", ")}.${errors.length > 0 ? ` ${errors.join(" ")}` : ""}`,
      missingConfigFields,
      resolvedInputSources: {
        awsAccountId: config.inputSources.awsAccountId,
        awsOrganizationId: config.inputSources.awsOrganizationId,
      },
      checkedAt: now,
    };
  }
  const evidence = path.join(config.evidenceDir, "check-aws-login", "sts-get-caller-identity.json");
  try {
    const runner = deps.commandRunner || defaultCommandRunner;
    const result = await runner("aws", ["sts", "get-caller-identity", "--output", "json"]);
    const identity = JSON.parse(result.stdout || "{}") as { Account?: string; Arn?: string };
    const errors: string[] = [];
    if (identity.Account !== config.awsAccountId) {
      errors.push(
        `AWS account mismatch: expected ${config.awsAccountId}, got ${identity.Account || "<empty>"}`,
      );
    }
    if (config.expectedAwsRoleArn && identity.Arn !== config.expectedAwsRoleArn) {
      errors.push(
        `AWS role ARN mismatch: expected ${config.expectedAwsRoleArn}, got ${identity.Arn || "<empty>"}`,
      );
    }
    await writeEvidence(evidence, {
      schemaVersion: "aws-account-aws-login@1",
      checkedAt: now,
      identity,
      errors,
    });
    return {
      state: errors.length > 0 ? "failed" : "passed",
      message: errors.length > 0 ? errors.join("; ") : "AWS login matches expected account/role",
      evidence,
      checkedAt: now,
    };
  } catch (error) {
    await writeEvidence(evidence, {
      schemaVersion: "aws-account-aws-login@1",
      checkedAt: now,
      error: String(error instanceof Error ? error.message : error),
    });
    return {
      state: "failed",
      message: "aws sts get-caller-identity failed",
      evidence,
      checkedAt: now,
    };
  }
}

function missingAwsIdentityFields(config: AwsAccountConfig): MissingConfigField[] {
  const fields: MissingConfigField[] = [];
  if (!config.awsAccountId) {
    const source = config.inputSources.awsAccountId;
    fields.push({
      field: "awsAccountId",
      valueHint: "<new-account-id>",
      destination: missingDestination(source),
      ref: source?.ref || CONTROL_PLANE_CONFIG_REFS.awsAccountId,
      category: source?.category,
      note: missingNote(
        "same account returned by aws sts get-caller-identity",
        config.inputErrors.awsAccountId,
      ),
    });
  }
  if (!config.awsOrganizationId) {
    const source = config.inputSources.awsOrganizationId;
    fields.push({
      field: "awsOrganizationId",
      valueHint: "<aws-organization-id>",
      destination: missingDestination(source),
      ref: source?.ref || CONTROL_PLANE_CONFIG_REFS.awsOrganizationId,
      category: source?.category,
      note: missingNote(
        "AWS Organizations id for the account, for example o-xxxxxxxxxx",
        config.inputErrors.awsOrganizationId,
      ),
    });
  }
  return fields;
}

function missingDestination(
  source: AwsAccountConfig["inputSources"][string],
): MissingConfigField["destination"] {
  if (!source?.ref) return "stack-config";
  return source.category === "bootstrap" && source.categoryExplicit
    ? "bootstrap-category"
    : source.source === "local-values"
      ? "project-local-config"
      : "project-shared-config";
}

function missingNote(base: string, error?: string) {
  return error ? `${base}; resolution error: ${error}` : base;
}
