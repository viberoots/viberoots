import * as fsp from "node:fs/promises";
import path from "node:path";
import { RUNBOOK_SCHEMA, type RunbookPhase } from "./cloud-control-runbook";
import { validateManagedDependencyEvidence } from "./control-plane-managed-dependency-validation";
import { validateAuthProviderProfile } from "./cloud-control-runtime-input";
import { validateCredentialMap } from "./cloud-control-credential-map";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import { validateProviderCapabilityHookEvidenceShape } from "./cloud-control-provider-capability-hook-contract";
import {
  validateCredentialRotationOutput,
  validateCredentialStagingOutput,
} from "./cloud-control-runbook-credential-evidence";

export async function validateRunbookBundle(bundleDir: string) {
  const profileRoot = path.resolve(bundleDir);
  const runbook = JSON.parse(await fsp.readFile(path.join(profileRoot, "commands.json"), "utf8"));
  const structureErrors = [
    ...validateRunbookStructure(runbook),
    ...(await validateGeneratedArtifacts(profileRoot)),
  ];
  const phases = structureErrors.length > 0 ? [] : await phaseStatuses(profileRoot, runbook);
  return {
    schemaVersion: "cloud-control-setup-doctor@1",
    profileRoot,
    ok: structureErrors.length === 0,
    structureErrors,
    phases,
  };
}

async function validateGeneratedArtifacts(profileRoot: string): Promise<string[]> {
  const errors: string[] = [];
  const config = await readJsonOrYaml(path.join(profileRoot, "config.yaml"));
  const auth = await readJson(path.join(profileRoot, "auth-provider-profile.json"));
  errors.push(
    ...validateAuthProviderProfile(auth, {
      expectedCallbackHost: config?.authProvider?.callback?.externalHost || "",
      expectedCallbackPath: config?.authProvider?.callback?.externalPath || "",
      production: true,
    }).map((error) => `auth-provider-profile.json: ${error}`),
  );
  const manifest = await readJson(path.join(profileRoot, "credential-manifest.json"));
  const map = await readJson(path.join(profileRoot, "credential-map.json"));
  const supabase = (await readJson(path.join(profileRoot, "supabase-postgres.profile.json"))) as
    | SupabaseManagedPostgresProfile
    | undefined;
  errors.push(
    ...validateCredentialMap(map, {
      requiredFiles: manifest?.requiredFiles || [],
      supabaseProjectRef: supabase?.provisioning.projectRef,
      connectionMode: supabase?.connection.mode,
      reviewedSourceMode: manifest?.reviewedSourceMode,
    }).map((error) => `credential-map.json: ${error}`),
  );
  const residual = await readJson(path.join(profileRoot, "residual-action-checklist.json"));
  if (residual?.schemaVersion !== "cloud-control-residual-actions@1") {
    errors.push("residual-action-checklist.json schemaVersion invalid");
  }
  if (!Array.isArray(residual?.actions) || residual.actions.length === 0) {
    errors.push("residual-action-checklist.json requires actions");
  }
  for (const [index, action] of (residual?.actions || []).entries()) {
    errors.push(...validateResidualAction(action, index));
  }
  return errors;
}

function validateResidualAction(action: any, index: number): string[] {
  const errors: string[] = [];
  const label = `residual-action-checklist.json actions[${index}]`;
  for (const field of ["id", "title", "phase", "type", "action", "evidence", "output"]) {
    if (!String(action?.[field] || "").trim()) errors.push(`${label} missing ${field}`);
  }
  if (!["operator-evidence", "operator-command"].includes(action?.type)) {
    errors.push(`${label} type is unsupported`);
  }
  for (const field of ["evidence", "output"] as const) {
    if (typeof action?.[field] !== "string" || !action[field].startsWith("$PROFILE_ROOT/")) {
      errors.push(`${label} ${field} must be a profile-root path`);
    }
  }
  if (!Array.isArray(action?.evidenceRequirements) || action.evidenceRequirements.length === 0) {
    errors.push(`${label} requires typed evidence requirements`);
  }
  if (JSON.stringify(action || {}).match(/placeholder|dashboard-only|self-attested/i)) {
    errors.push(`${label} contains placeholder residual action evidence`);
  }
  return errors;
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function readJsonOrYaml(file: string): Promise<any> {
  try {
    const YAML = await import("yaml");
    return YAML.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
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
  const evidenceErrors = (
    await Promise.all(outputs.map((file) => validateOutputEvidence(profileRoot, file)))
  ).flat();
  const status =
    blockedPrerequisites.length || missingInputs.length
      ? "blocked"
      : existingOutputs.length === outputs.length && evidenceErrors.length === 0
        ? "complete"
        : "ready";
  return {
    id: phase.id,
    status,
    blockedPrerequisites,
    missingInputs,
    existingOutputs,
    evidenceErrors,
  };
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

async function validateOutputEvidence(profileRoot: string, file: string): Promise<string[]> {
  if (
    file !== "$PROFILE_ROOT/managed-dependency-evidence.json" &&
    file !== "$PROFILE_ROOT/supabase-managed-postgres-evidence.json" &&
    file !== "$PROFILE_ROOT/credential-staging.json" &&
    file !== "$PROFILE_ROOT/credential-rotation.json"
  ) {
    return [];
  }
  if (file === "$PROFILE_ROOT/supabase-managed-postgres-evidence.json") {
    return validateSupabaseProviderOutput(profileRoot);
  }
  if (file === "$PROFILE_ROOT/credential-staging.json") {
    return validateCredentialStagingOutput(profileRoot);
  }
  if (file === "$PROFILE_ROOT/credential-rotation.json") {
    return validateCredentialRotationOutput(profileRoot);
  }
  const localPath = path.join(profileRoot, "managed-dependency-evidence.json");
  if (!(await exists(localPath))) return [];
  const evidence = JSON.parse(await fsp.readFile(localPath, "utf8"));
  return validateManagedDependencyEvidence(evidence, 60);
}

async function validateSupabaseProviderOutput(profileRoot: string): Promise<string[]> {
  const localPath = path.join(profileRoot, "supabase-managed-postgres-evidence.json");
  if (!(await exists(localPath))) return [];
  const [evidence, profile] = await Promise.all([
    readJson(localPath),
    readJson(path.join(profileRoot, "supabase-postgres.profile.json")),
  ]);
  return validateProviderCapabilityHookEvidenceShape("supabase-managed-postgres", evidence, {
    allowedPhases: ["evidence"],
    expectedSupabasePostgresProfile: profile,
  });
}
