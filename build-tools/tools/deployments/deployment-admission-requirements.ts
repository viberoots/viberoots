#!/usr/bin/env zx-wrapper
import { hasFlag } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";

export type DeploymentAdmissionRequirementsForCli = {
  admission_policy: string;
  allowed_refs: string[];
  required_checks: string[];
  required_approvals: string[];
  mark_check_passed: {
    relevant_for_workflow: boolean;
    authorization_required: "admission_reporter";
  };
};

export function deploymentAdmissionRequirementsForCli(
  deployment: DeploymentTarget,
): DeploymentAdmissionRequirementsForCli {
  return {
    admission_policy: deployment.admissionPolicyRef,
    allowed_refs: [...deployment.admissionPolicy.allowedRefs],
    required_checks: [...deployment.admissionPolicy.requiredChecks],
    required_approvals: [...deployment.admissionPolicy.requiredApprovals],
    mark_check_passed: {
      relevant_for_workflow: deployment.admissionPolicy.requiredChecks.length > 0,
      authorization_required: "admission_reporter",
    },
  };
}

export function missingMarkCheckPassedValueMessage(deployment: DeploymentTarget): string {
  const requirements = deploymentAdmissionRequirementsForCli(deployment);
  const currentArgs = stripMarkCheckPassedFromCurrentArgs(deployment);
  return [
    "--mark-check-passed needs an explicit check name for this deployment.",
    `deployment: ${deployment.label}`,
    `admission_policy: ${requirements.admission_policy}`,
    requirements.required_checks.length > 0
      ? `required_checks: ${requirements.required_checks.join(", ")}`
      : "required_checks: none",
    requirements.required_checks.length > 0
      ? `Run this instead: ${renderDeployCommand([
          ...currentArgs,
          "--mark-check-passed",
          requirements.required_checks.join(","),
        ])}`
      : `Run this instead: ${renderDeployCommand(currentArgs)}`,
    `Inspect requirements only: ${renderDeployCommand(["--deployment", deployment.label, "--validate-only"])}`,
    "Discovering required check names does not grant admission_reporter authorization.",
  ].join("\n");
}

function stripMarkCheckPassedFromCurrentArgs(deployment: DeploymentTarget): string[] {
  const raw = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i] || "";
    if (arg === "--mark-check-passed") {
      const next = raw[i + 1] || "";
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
    if (arg.startsWith("--mark-check-passed=")) continue;
    kept.push(arg);
  }
  return hasFlag("deployment") ? kept : ["--deployment", deployment.label, ...kept];
}

function renderDeployCommand(args: string[]): string {
  return ["deploy", ...args].join(" ");
}
