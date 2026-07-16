import { spawn } from "node:child_process";
import { resolveToolPathSync } from "../lib/tool-paths";
import { inspectArtifactSource } from "../lib/artifact-source-inventory";
import {
  artifactJobPurpose,
  assertArtifactBuildAdmitted,
  buildArtifactPolicyEvidence,
  serializeArtifactPolicyEvidence,
  type ArtifactBuildClassification,
  type ArtifactJobPurpose,
  type ArtifactPolicyEvidence,
} from "../lib/artifact-build-policy";

type CommandResult = { exitCode: number; stdout: string; stderr: string };

export type ArtifactSourceInspection = Awaited<ReturnType<typeof inspectArtifactSource>>;

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      resolve({ exitCode: -1, stdout: "", stderr: String(error) });
    });
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}

export async function inspectWorkspaceArtifactSource(opts: {
  workspaceRoot: string;
  targetPackages: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ArtifactSourceInspection> {
  const env = opts.env || process.env;
  const gitBin = resolveToolPathSync("git", env);
  return await inspectArtifactSource({
    targetPackages: opts.targetPackages,
    runGit: async () =>
      await runCommand(
        gitBin,
        ["ls-files", "-z", "--others", "--exclude-standard"],
        env,
        opts.workspaceRoot,
      ),
  });
}

export async function admitArtifactContext(opts: {
  classification: ArtifactBuildClassification;
  purpose?: ArtifactJobPurpose;
  impureEvaluation: boolean;
  env?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
  toolPaths?: Record<string, string | undefined>;
  toolNames?: string[];
}): Promise<ArtifactPolicyEvidence> {
  const env = opts.env || process.env;
  const evidence = await inspectArtifactBuildPolicy({
    classification: opts.classification,
    purpose: opts.purpose,
    impureEvaluation: opts.impureEvaluation,
    env,
    toolPaths: { node: process.execPath, ...opts.toolPaths },
    toolNames: opts.toolNames,
    runCommand: async (command, args) => await runCommand(command, args, env, opts.workspaceRoot),
  });
  emitArtifactPolicyEvidence(evidence);
  return evidence;
}

export async function inspectArtifactBuildPolicy(opts: {
  classification: ArtifactBuildClassification;
  purpose?: ArtifactJobPurpose;
  impureEvaluation: boolean;
  env: NodeJS.ProcessEnv;
  toolPaths?: Record<string, string | undefined>;
  toolNames?: string[];
  runCommand: (command: string, args: string[]) => Promise<CommandResult>;
}): Promise<ArtifactPolicyEvidence> {
  const purpose = opts.purpose || artifactJobPurpose(opts.env);
  let nixBin: string | undefined;
  let nixConfig: unknown;
  let inspection: "available" | "unavailable" | "invalid" = "unavailable";
  try {
    nixBin = resolveToolPathSync("nix", opts.env);
    const result = await opts.runCommand(nixBin, ["config", "show", "--json"]);
    if (result.exitCode === 0) {
      try {
        nixConfig = JSON.parse(result.stdout);
        inspection = "available";
      } catch {
        inspection = "invalid";
      }
    }
  } catch {
    inspection = "unavailable";
  }
  const toolPaths = { ...opts.toolPaths, nix: nixBin };
  for (const tool of opts.toolNames || []) {
    try {
      toolPaths[tool] = resolveToolPathSync(tool, opts.env);
    } catch {
      toolPaths[tool] = undefined;
    }
  }
  const evidence = buildArtifactPolicyEvidence({
    classification: opts.classification,
    purpose,
    impureEvaluation: opts.impureEvaluation,
    env: opts.env,
    toolPaths,
    nixConfig,
    nixInspection: inspection,
  });
  assertArtifactBuildAdmitted(evidence);
  return evidence;
}

export function emitArtifactPolicyEvidence(evidence: ArtifactPolicyEvidence): void {
  console.error(`[artifact-policy] ${serializeArtifactPolicyEvidence(evidence)}`);
}
