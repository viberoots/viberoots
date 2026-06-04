import { getFlagBool } from "../lib/cli";
import {
  PHASES,
  type AwsAccountConfig,
  type AwsAccountStatus,
  type RunDeps,
} from "./aws-account-types";
import { printJson } from "./aws-account-utils";
import {
  awsAccountBootstrapCommand,
  awsAccountCheckCommand,
  collectMissingConfigFields,
  formatInputSources,
  formatMissingDestinations,
  phaseStateLabel,
  wrapText,
} from "./aws-account-output-parts";

export function printCheckResult(
  status: AwsAccountStatus,
  config: AwsAccountConfig,
  deps: RunDeps,
  subcommand: "bootstrap" | "check",
): void {
  if (subcommand !== "check" || getFlagBool("json")) {
    printJson(status, deps);
    return;
  }
  (deps.stdout || console.log)(formatCheckSummary(status, config));
}

export function formatCheckSummary(status: AwsAccountStatus, config: AwsAccountConfig): string {
  const checkedPhases = PHASES.filter((phase) => status.phases[phase]?.state !== "pending");
  const problemPhases = checkedPhases.filter((phase) => {
    const state = status.phases[phase]?.state;
    return state === "blocked" || state === "failed";
  });
  const lines = [
    "AWS Account Check",
    "",
    `Stack:    ${config.stackName}`,
    `Domain:   ${config.domain}`,
    `Region:   ${config.region}`,
    `Evidence: ${status.evidenceDir}`,
    "",
    "Results",
  ];
  for (const phase of checkedPhases) {
    const record = status.phases[phase];
    lines.push(`  ${phaseStateLabel(record.state).padEnd(7)} ${phase}`);
  }
  lines.push("", "Sources", ...formatInputSources(status, config));
  if (config.localOverrides.length > 0) {
    lines.push("", "Active local overrides", ...formatLocalOverrides(config.localOverrides));
  }
  const missingConfigFields = collectMissingConfigFields(problemPhases, status);
  if (missingConfigFields.length > 0) {
    lines.push("", ...formatMissingDestinations(missingConfigFields));
  }
  const detailPhases =
    problemPhases.length > 0
      ? problemPhases
      : checkedPhases.filter((phase) => status.phases[phase]?.evidence);
  if (detailPhases.length > 0) {
    lines.push("", problemPhases.length > 0 ? "Problems" : "Evidence");
    for (const phase of detailPhases) {
      const record = status.phases[phase];
      lines.push(`  ${phase}`);
      if (problemPhases.includes(phase)) {
        const hasMissingConfigFields = (record.missingConfigFields || []).length > 0;
        lines.push(
          ...wrapText(
            hasMissingConfigFields ? "Waiting on missing values listed above." : record.message,
            4,
          ),
        );
      }
      if (record.evidence) {
        lines.push(...wrapText(record.evidence, 4, "evidence: "));
      }
    }
  }
  if (problemPhases.length > 0) {
    lines.push(
      "",
      "Next",
      "  Fix the problems above, then rerun:",
      `  ${awsAccountCheckCommand(status, false)}`,
    );
  } else {
    lines.push(
      "",
      "Next",
      "  All prerequisite checks passed.",
      `  ${awsAccountBootstrapCommand(status)}`,
    );
  }
  lines.push(
    "",
    "Files",
    `  ${path.join(status.evidenceDir, "status.json")}`,
    "",
    "Automation",
    `  ${awsAccountCheckCommand(status, true)}`,
  );
  return lines.join("\n");
}

function formatLocalOverrides(overrides: AwsAccountConfig["localOverrides"]): string[] {
  return overrides.map(
    (entry) =>
      `  ${entry.path}: shared=${formatDiagnosticValue(entry.sharedValue)} local=${formatDiagnosticValue(entry.localValue)}`,
  );
}

function formatDiagnosticValue(value: unknown): string {
  if (value === undefined) return "<unset>";
  if (typeof value === "string") return value || "<empty>";
  return JSON.stringify(value);
}
