import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import type { AwsAccountConfig, AwsAccountStatus, PhaseRecord, RunDeps } from "./aws-account-types";
import { defaultCommandRunner, writeEvidence } from "./aws-account-utils";

export async function bootstrapState(
  config: AwsAccountConfig,
  deps: RunDeps,
  now: string,
  status: AwsAccountStatus,
): Promise<PhaseRecord> {
  const blockers = (["check-tools", "check-aws-login"] as const).filter(
    (phase) => status.phases[phase].state !== "passed",
  );
  if (blockers.length > 0) {
    return {
      state: "blocked",
      message: `remote-state bootstrap requires passed phases first: ${blockers.join(", ")}`,
      checkedAt: now,
    };
  }
  const repoRoot = await findRepoRoot(deps.cwd || process.cwd());
  const moduleDir = path.join(
    repoRoot,
    "build-tools",
    "deployments",
    "aws-control-plane-state-bootstrap",
    "opentofu",
  );
  const phaseDir = path.resolve(deps.cwd || process.cwd(), config.evidenceDir, "bootstrap-state");
  const workDir = path.join(phaseDir, "opentofu-workdir");
  const tfvarsPath = path.join(workDir, "account.auto.tfvars.json");
  const planPath = path.join(workDir, "state-bootstrap.tfplan");
  const planEvidencePath = path.join(phaseDir, "plan.json");
  const outputEvidencePath = path.join(phaseDir, "state-bootstrap-evidence.json");
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.mkdir(workDir, { recursive: true });
  await fsp.cp(moduleDir, workDir, { recursive: true });
  await writeEvidence(tfvarsPath, {
    region: config.region,
    state_bucket_name: config.stateBucketName,
    state_lock_table_name: config.stateLockTableName,
    backend_state_key: config.backendStateKey,
    tags: {
      Stack: config.stackName,
      Domain: config.domain,
      ManagedBy: "viberoots-control-plane",
      Purpose: "opentofu-remote-state-bootstrap",
    },
  });
  const runner = deps.commandRunner || defaultCommandRunner;
  const env = { ...process.env, TF_IN_AUTOMATION: "1" };
  try {
    const init = await runner("tofu", ["init", "-backend=false", "-input=false"], {
      cwd: workDir,
      env,
    });
    const plan = await runner(
      "tofu",
      ["plan", "-input=false", `-var-file=${tfvarsPath}`, `-out=${planPath}`],
      { cwd: workDir, env },
    );
    await writeEvidence(planEvidencePath, {
      schemaVersion: "aws-account-bootstrap-state-plan@1",
      checkedAt: now,
      moduleDir,
      workDir,
      tfvarsPath,
      planPath,
      applyRequested: getFlagBool("apply"),
      initStdout: init.stdout,
      initStderr: init.stderr,
      planStdout: plan.stdout,
      planStderr: plan.stderr,
      stateBucketName: config.stateBucketName,
      stateLockTableName: config.stateLockTableName,
      backendStateKey: config.backendStateKey,
    });
    if (!getFlagBool("apply")) {
      return {
        state: "manual",
        message:
          "remote-state bootstrap plan is ready; rerun bootstrap with --apply to create the S3 state bucket and DynamoDB lock table through OpenTofu",
        evidence: planEvidencePath,
        checkedAt: now,
      };
    }
    const apply = await runner("tofu", ["apply", "-input=false", "-auto-approve", planPath], {
      cwd: workDir,
      env,
    });
    const output = await runner("tofu", ["output", "-json", "state_bootstrap_evidence"], {
      cwd: workDir,
      env,
    });
    let outputValue: unknown;
    try {
      outputValue = JSON.parse(output.stdout || "{}");
    } catch {
      outputValue = { rawStdout: output.stdout };
    }
    await writeEvidence(outputEvidencePath, {
      schemaVersion: "aws-account-bootstrap-state-apply@1",
      checkedAt: now,
      applyStdout: apply.stdout,
      applyStderr: apply.stderr,
      outputStdout: output.stdout,
      outputStderr: output.stderr,
      stateBootstrapEvidence: outputValue,
      backendHcl: {
        bucket: config.stateBucketName,
        key: config.backendStateKey,
        region: config.region,
        dynamodb_table: config.stateLockTableName,
        encrypt: true,
      },
    });
    return {
      state: "passed",
      message:
        "remote-state bootstrap applied through OpenTofu; backend bucket/table evidence captured",
      evidence: outputEvidencePath,
      checkedAt: now,
    };
  } catch (error) {
    const errorEvidencePath = path.join(phaseDir, "error.json");
    await writeEvidence(errorEvidencePath, {
      schemaVersion: "aws-account-bootstrap-state-error@1",
      checkedAt: now,
      error: String(error instanceof Error ? error.message : error),
      workDir,
      tfvarsPath,
    });
    return {
      state: "failed",
      message: "remote-state bootstrap OpenTofu command failed",
      evidence: errorEvidencePath,
      checkedAt: now,
    };
  }
}
