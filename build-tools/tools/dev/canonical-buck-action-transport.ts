import fs from "node:fs";
import path from "node:path";

import { validateArtifactToolsRoot } from "../lib/artifact-tool-authority";
import { withoutArtifactEnvironmentInfluence } from "../lib/artifact-environment-policy";

type Transport = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  workspaceRoot: string;
  artifactToolsRoot: string;
};

function flagValue(argv: readonly string[], name: string): string {
  const prefix = `--${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === `--${name}`) return String(argv[index + 1] || "").trim();
    if (token.startsWith(prefix)) return token.slice(prefix.length).trim();
  }
  return "";
}

function declaredInputSet(argv: readonly string[]): Set<string> {
  const manifest = flagValue(argv, "buck-action-inputs");
  if (!path.isAbsolute(manifest)) {
    throw new Error("declared Buck action requires an absolute --buck-action-inputs manifest");
  }
  const stat = fs.lstatSync(manifest);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("declared Buck action input manifest must be a regular file");
  }
  return new Set(
    fs
      .readFileSync(manifest, "utf8")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => fs.realpathSync(entry)),
  );
}

function declaredActionStateRoot(argv: readonly string[], manifest: string): string {
  const rawRoot = flagValue(argv, "buck-action-state-root");
  if (!path.isAbsolute(rawRoot)) {
    throw new Error("declared Buck action requires an absolute --buck-action-state-root");
  }
  const stateRoot = fs.realpathSync(rawRoot);
  if (!fs.statSync(stateRoot).isDirectory() || fs.lstatSync(rawRoot).isSymbolicLink()) {
    throw new Error("declared Buck action state root must be a real directory");
  }
  const manifestReal = fs.realpathSync(manifest);
  if (!manifestReal.startsWith(stateRoot + path.sep)) {
    throw new Error("declared Buck action input manifest must be owned by its action state root");
  }
  return stateRoot;
}

function declaredPath(value: string, description: string, inputs: ReadonlySet<string>): string {
  if (!path.isAbsolute(value)) throw new Error(`${description} must be an absolute path`);
  const resolved = fs.realpathSync(value);
  if (!inputs.has(resolved)) {
    throw new Error(`${description} is not present in the declared Buck action inputs: ${value}`);
  }
  return resolved;
}

function addValueArg(argv: string[], name: string, value: string): void {
  if (value && !flagValue(argv, name)) argv.push(`--${name}=${value}`);
}

function declaredWorkspaceRoot(argv: readonly string[], inputs: ReadonlySet<string>): string {
  const rawMarker = flagValue(argv, "workspace-root-marker");
  declaredPath(rawMarker, "declared workspace-root marker", inputs);
  const marker = path.resolve(rawMarker);
  const suffix = path.join(".viberoots", "workspace", "buck", "workspace-root.env");
  if (!marker.endsWith(path.sep + suffix)) {
    throw new Error("declared workspace-root marker has an invalid canonical location");
  }
  const root = marker.slice(0, -(suffix.length + 1));
  if (!root || path.resolve(root, suffix) !== marker) {
    throw new Error("declared workspace-root marker escapes its canonical workspace");
  }
  return fs.realpathSync(root);
}

function declaredArtifactToolsRoot(
  argv: readonly string[],
  inputs: ReadonlySet<string>,
  stateRoot: string,
): string {
  const rawMarker = flagValue(argv, "artifact-tools-marker");
  const marker = declaredPath(rawMarker, "declared artifact-tools marker", inputs);
  if (fs.lstatSync(rawMarker).isSymbolicLink() || path.dirname(marker) !== stateRoot) {
    throw new Error("declared artifact-tools marker must be an action-state-owned regular file");
  }
  const lines = fs
    .readFileSync(marker, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("declared artifact-tools marker must contain exactly one store root");
  }
  return validateArtifactToolsRoot(lines[0]!, "declared Buck action tool authority");
}

export function canonicalBuckActionTransport(
  argv: readonly string[],
  sourceEnv: NodeJS.ProcessEnv,
  enabled: boolean,
  executingNode = process.execPath,
): Transport {
  if (!enabled) {
    return { argv: [...argv], env: { ...sourceEnv }, workspaceRoot: "", artifactToolsRoot: "" };
  }

  const manifest = flagValue(argv, "buck-action-inputs");
  const stateRoot = declaredActionStateRoot(argv, manifest);
  const inputs = declaredInputSet(argv);
  const workspaceRoot = declaredWorkspaceRoot(argv, inputs);
  const assertedWorkspaceRoot = flagValue(argv, "workspace-root");
  if (assertedWorkspaceRoot && fs.realpathSync(assertedWorkspaceRoot) !== workspaceRoot) {
    throw new Error("declared Buck workspace root does not match its declared marker");
  }
  const testSource = path.resolve(
    flagValue(argv, "buck-test-src") || String(sourceEnv.BUCK_TEST_SRC || workspaceRoot).trim(),
  );
  if (fs.realpathSync(testSource) !== fs.realpathSync(workspaceRoot)) {
    throw new Error("declared Buck test source must match the declared workspace root");
  }
  const rawGraph =
    flagValue(argv, "buck-graph-json") || String(sourceEnv.BUCK_GRAPH_JSON || "").trim();
  const graphPath = rawGraph ? declaredPath(rawGraph, "declared Buck graph", inputs) : "";
  const canonicalArgv = [...argv];
  addValueArg(canonicalArgv, "workspace-root", workspaceRoot);
  addValueArg(canonicalArgv, "buck-test-src", fs.realpathSync(testSource));
  addValueArg(canonicalArgv, "buck-graph-json", graphPath);

  const artifactToolsRoot = declaredArtifactToolsRoot(argv, inputs, stateRoot);
  if (
    fs.realpathSync(executingNode) !== fs.realpathSync(path.join(artifactToolsRoot, "bin", "node"))
  ) {
    throw new Error("declared Buck action must start under its declared canonical Node");
  }
  const transportedArtifactToolsRoot = String(sourceEnv.VBR_ARTIFACT_TOOLS_ROOT || "").trim();
  if (transportedArtifactToolsRoot !== artifactToolsRoot) {
    throw new Error("transported Buck action tool authority does not match its declared marker");
  }

  const env = withoutArtifactEnvironmentInfluence(sourceEnv);
  return {
    argv: canonicalArgv,
    env,
    workspaceRoot,
    artifactToolsRoot,
  };
}
