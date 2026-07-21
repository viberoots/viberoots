import { inspectArtifactSource } from "../lib/artifact-source-inventory";
import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import {
  artifactJobPurpose,
  assertArtifactClassificationAdmitted,
  assertArtifactBuildAdmitted,
  buildArtifactPolicyEvidence,
  serializeArtifactPolicyEvidence,
  type ArtifactBuildClassification,
  type ArtifactJobPurpose,
  type ArtifactPolicyEvidence,
} from "../lib/artifact-build-policy";
import { artifactNixPolicyConfigArgs } from "../lib/artifact-nix-policy";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { buildArtifactEnvironment } from "../lib/artifact-environment";
import { canonicalArtifactToolsRoot, validateArtifactToolsRoot } from "../lib/artifact-environment";
import path from "node:path";
import fs from "node:fs";

type CommandResult = { exitCode: number; stdout: string; stderr: string };

export function hasRejectedNixPolicyDiagnostics(stderr: string): boolean {
  return /(?:ignoring|ignored|cannot set|not allowed to set|not trusted).*(?:option|setting)|(?:option|setting).*(?:restricted|requires? a trusted user)/iu.test(
    stderr,
  );
}

export type ArtifactSourceInspection = Awaited<ReturnType<typeof inspectArtifactSource>>;

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<CommandResult> {
  return await runBoundedArtifactCommand({ command, args, env, cwd, timeoutMs: 60_000 });
}

export async function inspectWorkspaceArtifactSource(opts: {
  workspaceRoot: string;
  targetPackages: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ArtifactSourceInspection> {
  const env = opts.env || process.env;
  const gitBin = ensureNixStoreToolPathSync("git", env);
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
  internal?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
  toolPaths?: Record<string, string | undefined>;
  toolNames?: string[];
  artifactToolsRoot?: string;
}): Promise<ArtifactPolicyEvidence> {
  const inherited = opts.env || process.env;
  const purpose = opts.purpose || artifactJobPurpose(inherited);
  assertArtifactClassificationAdmitted({
    classification: opts.classification,
    purpose,
    impureEvaluation: opts.impureEvaluation,
  });
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const toolsRoot = opts.artifactToolsRoot
    ? validateArtifactToolsRoot(opts.artifactToolsRoot, "declared artifact tool authority")
    : canonicalArtifactToolsRoot(workspaceRoot, String(inherited.VBR_ARTIFACT_TOOLS_ROOT || ""));
  const canonicalNode = fs.realpathSync(path.join(toolsRoot, "bin", "node"));
  const currentNode = fs.realpathSync(process.execPath);
  if (currentNode !== canonicalNode) {
    throw new Error(
      `artifact entrypoint must execute under the canonical Node closure: actual=${currentNode} canonical=${canonicalNode}; invoke the public zx-wrapper entrypoint`,
    );
  }
  const env = buildArtifactEnvironment({
    baseEnv: inherited,
    mode: purpose === "local" ? "local" : "ci",
    stateRoot: path.join(workspaceRoot, "buck-out", "tmp", "artifact-environment"),
    workspaceRoot,
    artifactToolsRoot: toolsRoot,
    internal: opts.internal,
  });
  const evidence = await inspectArtifactBuildPolicy({
    classification: opts.classification,
    purpose,
    impureEvaluation: opts.impureEvaluation,
    env,
    toolPaths: opts.toolPaths,
    toolNames: opts.toolNames,
    runCommand: async (command, args) => await runCommand(command, args, env, workspaceRoot),
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
  let nixStoreUrl = "";
  let inspection: "available" | "unavailable" | "invalid" = "unavailable";
  try {
    nixBin = ensureNixStoreToolPathSync("nix", opts.env);
    const result = await opts.runCommand(nixBin, artifactNixPolicyConfigArgs());
    if (result.exitCode === 0 && !hasRejectedNixPolicyDiagnostics(result.stderr)) {
      try {
        nixConfig = JSON.parse(result.stdout);
        inspection = "available";
      } catch {
        inspection = "invalid";
      }
      const store = await opts.runCommand(nixBin, ["store", "info", "--json"]);
      if (store.exitCode === 0 && !hasRejectedNixPolicyDiagnostics(store.stderr)) {
        const parsed = JSON.parse(store.stdout) as { url?: unknown };
        nixStoreUrl = String(parsed.url || "");
      } else {
        inspection = "invalid";
      }
    } else if (result.exitCode === 0) {
      inspection = "invalid";
    }
  } catch {
    inspection = "unavailable";
  }
  const canonicalNode = ensureNixStoreToolPathSync("node", opts.env);
  const actualNode = String(process.execPath).trim();
  if (!actualNode) {
    throw new Error("artifact build cannot prove the executing Node path");
  }
  {
    let actualReal: string;
    let canonicalReal: string;
    try {
      actualReal = fs.realpathSync(actualNode);
      canonicalReal = fs.realpathSync(canonicalNode);
    } catch (error) {
      throw new Error(`artifact build cannot prove the executing Node path: ${actualNode}`, {
        cause: error,
      });
    }
    if (actualReal !== canonicalReal) {
      throw new Error(
        `artifact build executing Node is outside the canonical tool closure: actual=${actualReal} canonical=${canonicalReal}`,
      );
    }
  }
  const toolPaths = {
    ...opts.toolPaths,
    node: canonicalNode,
    nix: nixBin,
  };
  for (const tool of opts.toolNames || []) {
    try {
      toolPaths[tool] = ensureNixStoreToolPathSync(tool, opts.env);
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
    nixStoreUrl,
  });
  assertArtifactBuildAdmitted(evidence);
  return evidence;
}

export function emitArtifactPolicyEvidence(evidence: ArtifactPolicyEvidence): void {
  console.error(`[artifact-policy] ${serializeArtifactPolicyEvidence(evidence)}`);
}
