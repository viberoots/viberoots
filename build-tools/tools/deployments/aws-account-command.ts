import { getFlagBool } from "../lib/cli";
import type {
  AwsAccountConfig,
  AwsAccountStatus,
  Phase,
  PhaseRecord,
  RunDeps,
  Subcommand,
} from "./aws-account-types";
import { readAwsAccountConfig } from "./aws-account-config-read";
import {
  initStackConfig,
  isMissingStackIdentityError,
  maybeInitStackConfigInteractively,
} from "./aws-account-config-init";
import { checkAwsLogin, checkTools } from "./aws-account-check-tools";
import { checkSupabase } from "./aws-account-check-supabase";
import { bootstrapState } from "./aws-account-bootstrap";
import { cleanEvidence, printStatus, validateEvidence } from "./aws-account-evidence";
import { printCheckResult } from "./aws-account-output";
import { printSetupPlan, printSetupPlanWithoutStack } from "./aws-account-setup-plan";
import { freshStatus, nextPhase, readStatus, writeStatusAndInputs } from "./aws-account-status";
import {
  assertNoOperatorSupabasePlanInput,
  assertNoSupabaseAccessTokenRefCliInputs,
  isoNow,
  printJson,
  printUsage,
  selectedSubcommand,
} from "./aws-account-utils";

export async function runAwsAccountCommand(deps: RunDeps = {}): Promise<void> {
  const subcommand = selectedSubcommand();
  if (getFlagBool("help")) {
    printUsage(deps.stdout);
    return;
  }
  assertNoOperatorSupabasePlanInput({});
  assertNoSupabaseAccessTokenRefCliInputs();
  if (subcommand === "config-init") return initStackConfig(deps.cwd || process.cwd(), deps);
  const cwd = deps.cwd || process.cwd();
  const config = await readAwsAccountConfigForCommand(cwd, deps, subcommand);
  if (!config) return;
  if (subcommand === "setup-plan") return printSetupPlan(config, deps);
  if (subcommand === "status") return printStatus(config, deps);
  if (subcommand === "clean") return cleanEvidence(config, deps);
  if (subcommand === "evidence") return validateEvidence(config, deps);
  if (subcommand === "resume") return resumeFreshAccount(config, deps);
  return runChecks(config, deps, subcommand);
}

async function readAwsAccountConfigForCommand(
  cwd: string,
  deps: RunDeps,
  subcommand: Subcommand,
): Promise<AwsAccountConfig | undefined> {
  try {
    return await readAwsAccountConfig(cwd);
  } catch (error) {
    if (subcommand === "setup-plan" && isMissingStackIdentityError(error)) {
      await printSetupPlanWithoutStack(cwd, deps);
      return undefined;
    }
    if (subcommand !== "check" && subcommand !== "bootstrap") {
      throw error;
    }
    if (!isMissingStackIdentityError(error)) throw error;
    if (getFlagBool("json")) throw error;
    if (!(await maybeInitStackConfigInteractively(cwd, deps))) return undefined;
    return await readAwsAccountConfig(cwd);
  }
}

async function runChecks(
  config: AwsAccountConfig,
  deps: RunDeps,
  subcommand: "bootstrap" | "check",
): Promise<void> {
  const now = isoNow(deps);
  const status = freshStatus(config, now);
  const toolResult = await checkTools(config, deps, now);
  status.phases["check-tools"] = toolResult;
  if (toolResult.state !== "passed") {
    await writeStatusAndInputs(config, status);
    printCheckResult(status, config, deps, subcommand);
    process.exitCode = 2;
    return;
  }
  status.phases["check-aws-login"] = await checkAwsLogin(config, deps, now);
  status.phases["check-supabase"] = await checkSupabase(config, deps, now);
  if (subcommand === "bootstrap") {
    status.phases["bootstrap-state"] = await bootstrapState(config, deps, now, status);
  }
  status.nextPhase = nextPhase(status);
  await writeStatusAndInputs(config, status);
  printCheckResult(status, config, deps, subcommand);
  if (
    Object.values(status.phases).some(
      (phase) => phase.state === "failed" || phase.state === "blocked",
    )
  ) {
    process.exitCode = 2;
  }
}

async function resumeFreshAccount(config: AwsAccountConfig, deps: RunDeps): Promise<void> {
  const status = await readStatus(config);
  const phase = status.nextPhase || nextPhase(status);
  if (
    phase === "check-tools" ||
    phase === "check-aws-login" ||
    phase === "check-supabase" ||
    phase === "bootstrap-state"
  ) {
    return runChecks(config, deps, phase === "bootstrap-state" ? "bootstrap" : "check");
  }
  printJson(
    {
      ...status,
      resume: {
        nextPhase: phase,
        message: phase
          ? `resume cannot execute ${phase} yet; run the documented phase command manually`
          : "all implemented aws-account phases are complete",
      },
    },
    deps,
  );
  if (phase) process.exitCode = 2;
}
