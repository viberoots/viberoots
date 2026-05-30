import * as fsp from "node:fs/promises";
import path from "node:path";
import { RUNBOOK_SCHEMA, type RunbookPhase } from "./cloud-control-runbook";

export async function validateRunbookBundle(bundleDir: string) {
  const profileRoot = path.resolve(bundleDir);
  const runbook = JSON.parse(await fsp.readFile(path.join(profileRoot, "commands.json"), "utf8"));
  const structureErrors = validateRunbookStructure(runbook);
  const phases = structureErrors.length > 0 ? [] : await phaseStatuses(profileRoot, runbook);
  return {
    schemaVersion: "cloud-control-setup-doctor@1",
    profileRoot,
    ok: structureErrors.length === 0,
    structureErrors,
    phases,
  };
}

export function validateRunbookStructure(runbook: any): string[] {
  const errors: string[] = [];
  if (runbook?.schemaVersion !== RUNBOOK_SCHEMA) errors.push("commands.json schemaVersion invalid");
  if (!runbook?.profileRoot?.bundleRelative) errors.push("commands.json missing profileRoot");
  if (!Array.isArray(runbook?.phases) || runbook.phases.length === 0) {
    errors.push("commands.json requires ordered phases");
    return errors;
  }
  runbook.phases.forEach((phase: any, index: number) => {
    if (phase.order !== index + 1) errors.push(`${phase.id || index}: phase order is unstable`);
    for (const field of ["prerequisites", "evidenceInputs", "residualManualActions", "commands"]) {
      if (!Array.isArray(phase[field])) errors.push(`${phase.id}: ${field} must be an array`);
    }
    for (const command of phase.commands || []) {
      if (!command.id || !command.command) errors.push(`${phase.id}: command is missing id/body`);
      if (!Array.isArray(command.inputs) || !Array.isArray(command.outputs)) {
        errors.push(`${command.id}: command must declare inputs and outputs`);
      }
      for (const output of command.outputs || []) {
        if (typeof output !== "string" || !output.startsWith("$PROFILE_ROOT/")) {
          errors.push(`${command.id}: command output must be a profile-root path`);
        }
      }
      if (command.cwd !== "profile-root")
        errors.push(`${command.id}: command cwd must be profile-root`);
    }
  });
  return errors;
}

async function phaseStatuses(profileRoot: string, runbook: any) {
  const statuses: any[] = [];
  for (const phase of runbook.phases as RunbookPhase[]) {
    statuses.push(await phaseStatus(profileRoot, phase, statuses));
  }
  return statuses;
}

async function phaseStatus(profileRoot: string, phase: RunbookPhase, prior: any[]) {
  const blockedPrerequisites = phase.prerequisites.filter(
    (id) => prior.find((entry) => entry.id === id)?.status !== "complete",
  );
  const missingInputs = (
    await Promise.all(
      phase.commands.flatMap((command) => command.inputs).map((file) => missing(profileRoot, file)),
    )
  ).filter(Boolean);
  const outputs = phase.commands.flatMap((command) => command.outputs);
  const existingOutputs = (
    await Promise.all(outputs.map((file) => present(profileRoot, file)))
  ).filter(Boolean);
  const status =
    existingOutputs.length === outputs.length
      ? "complete"
      : blockedPrerequisites.length || missingInputs.length
        ? "blocked"
        : "ready";
  return { id: phase.id, status, blockedPrerequisites, missingInputs, existingOutputs };
}

async function missing(profileRoot: string, file: string): Promise<string> {
  if (!file.startsWith("$PROFILE_ROOT/")) return "";
  const localPath = path.join(profileRoot, file.slice("$PROFILE_ROOT/".length));
  return (await exists(localPath)) ? "" : file;
}

async function present(profileRoot: string, file: string): Promise<string> {
  if (!file.startsWith("$PROFILE_ROOT/")) return "";
  const localPath = path.join(profileRoot, file.slice("$PROFILE_ROOT/".length));
  return (await exists(localPath)) ? file : "";
}

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}
