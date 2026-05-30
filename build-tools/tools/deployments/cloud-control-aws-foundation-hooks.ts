import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { redactEvidenceValue } from "./cloud-control-evidence-helpers";
import {
  assumeAwsFoundationRole,
  awsFoundationCredentialEnv,
  awsFoundationCredentialIdentity,
} from "./cloud-control-aws-foundation-credentials";
import { inspectAwsFoundationProfile } from "./cloud-control-aws-foundation-inspect";
import { validateAwsFoundationProfile } from "./cloud-control-aws-foundation-profile";
import { AWS_TOPOLOGY_EVIDENCE_SCHEMA } from "./cloud-control-aws-topology-types";
import type {
  CloudProviderCapabilityHookPhase,
  HookAdapter,
  HookAdapterPhaseOptions,
  HookAdapterResult,
} from "./cloud-control-provider-capability-hooks";

export const AWS_FOUNDATION_HOOK_PAYLOAD_SCHEMA = "aws-foundation-hook-payload@1" as const;
const DEFAULT_TOFU_DIR = "build-tools/deployments/aws-control-plane-foundation/opentofu";

export function awsFoundationHookAdapter(capabilityId: string): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase) => {
    return async (opts: HookAdapterPhaseOptions) =>
      foundationHookResult(capabilityId, selectedPhase, opts, phaseOperation(selectedPhase));
  };
  return {
    name: `repo-owned-${capabilityId}`,
    automated: true,
    preview: phase("preview"),
    apply: phase("apply"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback"),
  };
}

function foundationHookResult(
  capabilityId: string,
  phase: CloudProviderCapabilityHookPhase,
  opts: HookAdapterPhaseOptions,
  operation: AwsFoundationPhaseOperation,
): HookAdapterResult {
  const foundation = opts.awsFoundationInspection || inspectAwsFoundationProfile();
  const errors = validateAwsFoundationProfile(foundation, {
    maxAgeMinutes: 60,
    expectedArtifactBackend: capabilityId === "aws-s3-artifact-store" ? "aws-s3" : undefined,
    capabilityId,
  });
  if (errors.length > 0) {
    throw new Error(`${capabilityId}: AWS foundation profile rejected: ${errors.join("; ")}`);
  }
  const payload = {
    schemaVersion: AWS_FOUNDATION_HOOK_PAYLOAD_SCHEMA,
    capabilityId,
    phase,
    deploymentLabel: opts.deploymentLabel,
    reviewedReference: opts.declaration.iac.reviewedReference,
    topologySchemaVersion: AWS_TOPOLOGY_EVIDENCE_SCHEMA,
    operation,
    foundation: redactEvidenceValue(foundation),
  };
  return {
    summary: `${capabilityId} ${phase}`,
    rawOutput: JSON.stringify(payload),
    payload,
  };
}

type AwsFoundationPhaseOperation = {
  tool: "opentofu" | "aws-inspection";
  action: "plan" | "apply" | "collect-evidence" | "smoke" | "destroy-plan";
  executed: boolean;
  command: string[];
  outputDigest: string;
  credentialIdentity?: string;
};

function phaseOperation(phase: CloudProviderCapabilityHookPhase): AwsFoundationPhaseOperation {
  if (phase === "evidence") return inspectOperation();
  if (phase === "smoke") return smokeOperation();
  const action = phase === "rollback" ? "destroy-plan" : phase === "apply" ? "apply" : "plan";
  return tofuOperation(action);
}

function tofuOperation(action: "plan" | "apply" | "destroy-plan"): AwsFoundationPhaseOperation {
  const cwd = path.resolve(process.env.VBR_AWS_FOUNDATION_TOFU_DIR || DEFAULT_TOFU_DIR);
  const varFile = process.env.VBR_AWS_FOUNDATION_VAR_FILE?.trim();
  const execute = process.env.VBR_AWS_FOUNDATION_EXECUTE_TOFU === "1";
  const command = tofuCommand(action, varFile);
  const credentials = execute ? tofuCredentials() : undefined;
  const output = execute
    ? runTofu(cwd, command, credentials!.env)
    : JSON.stringify({ cwd, command, execute });
  return {
    tool: "opentofu",
    action,
    executed: execute,
    command,
    outputDigest: digest(output),
    ...(credentials ? { credentialIdentity: credentials.identity } : {}),
  };
}

function tofuCommand(action: "plan" | "apply" | "destroy-plan", varFile?: string): string[] {
  const args = ["tofu", action === "apply" ? "apply" : "plan", "-input=false"];
  if (varFile) args.push(`-var-file=${varFile}`);
  if (action === "plan") args.push("-out=aws-foundation.tfplan");
  if (action === "apply") args.push("aws-foundation.tfplan");
  if (action === "destroy-plan") args.push("-destroy", "-out=aws-foundation-rollback.tfplan");
  return args;
}

function runTofu(cwd: string, command: string[], env: NodeJS.ProcessEnv): string {
  const backendConfig =
    process.env.VBR_AWS_FOUNDATION_BACKEND_CONFIG?.trim() || path.join(cwd, "backend.hcl");
  if (!fs.existsSync(backendConfig)) {
    throw new Error("OpenTofu AWS foundation execution requires backend config");
  }
  execFileSync("tofu", ["init", "-input=false", `-backend-config=${backendConfig}`], {
    cwd,
    encoding: "utf8",
    env,
  });
  const workspace = process.env.VBR_AWS_FOUNDATION_WORKSPACE?.trim() || "deployment-control-plane";
  try {
    execFileSync("tofu", ["workspace", "select", workspace], { cwd, encoding: "utf8", env });
  } catch {
    execFileSync("tofu", ["workspace", "new", workspace], { cwd, encoding: "utf8", env });
  }
  return execFileSync(command[0], command.slice(1), { cwd, encoding: "utf8", env });
}

function inspectOperation(): AwsFoundationPhaseOperation {
  const command = ["aws", "sts", "get-caller-identity"];
  return {
    tool: "aws-inspection",
    action: "collect-evidence",
    executed: false,
    command,
    outputDigest: digest(command.join(" ")),
  };
}

function smokeOperation(): AwsFoundationPhaseOperation {
  const command = ["tofu", "plan", "-detailed-exitcode", "-input=false"];
  return {
    tool: "opentofu",
    action: "smoke",
    executed: false,
    command,
    outputDigest: digest(command.join(" ")),
  };
}

function digest(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function tofuCredentials(): { env: NodeJS.ProcessEnv; identity: string } {
  const roleArn = process.env.VBR_AWS_FOUNDATION_ASSUME_ROLE_ARN?.trim();
  const sourceEnv = awsFoundationCredentialEnv();
  if (process.env.VBR_AWS_FOUNDATION_LIVE === "1" && roleArn) {
    return assumeAwsFoundationRole(roleArn, sourceEnv);
  }
  return { env: sourceEnv, identity: awsFoundationCredentialIdentity() };
}
