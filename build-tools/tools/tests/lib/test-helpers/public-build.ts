import path from "node:path";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../../lib/artifact-environment";
import { viberootsTool } from "../../scaffolding/lib/viberoots-tools";

type ZxShell = any;
type ZxResult = any;

function publicBuildEnv(tmp: string): Record<string, string> {
  const env = withoutArtifactEnvironmentInfluence(process.env);
  delete env.IN_NIX_SHELL;
  delete env.NO_DEV_SHELL;
  env.PATH = [path.join(canonicalArtifactToolsRoot(tmp), "bin"), env.PATH || ""]
    .filter(Boolean)
    .join(path.delimiter);
  return env;
}

export async function runPublicBuild(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  wasmBackend?: string;
  showOutput?: boolean;
  reject?: boolean;
}): Promise<ZxResult> {
  const buildTool = viberootsTool("build-tools/tools/bin/b");
  const options = [
    args.wasmBackend ? `--wasm-backend=${args.wasmBackend}` : "",
    args.showOutput ? "--show-output" : "",
  ].filter(Boolean);
  return await args.$({
    cwd: args.tmp,
    stdio: "pipe",
    env: { ...publicBuildEnv(args.tmp), VBR_VERBOSE: args.showOutput ? "1" : "" },
    reject: args.reject ?? true,
    nothrow: !(args.reject ?? true),
  })`${buildTool} ${args.target} ${options}`;
}

export async function publicBuildOutPath(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  wasmBackend?: string;
}): Promise<string> {
  const result = await runPublicBuild({ ...args, showOutput: true });
  const output = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
  return parsePublicBuildOutPath(output, args.target, args.tmp);
}

export function parsePublicBuildOutPath(
  output: string,
  target: string,
  workspaceRoot: string,
): string {
  const matches = output
    .trim()
    .split(/\n+/)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (fields) =>
        fields.length === 2 &&
        (fields[0] === target || /^[A-Za-z0-9_.-]+\/\//.test(fields[0])) &&
        fields[0].endsWith(target) &&
        fields[1].startsWith("buck-out/"),
    )
    .map((fields) => fields[1]);
  if (matches.length !== 1) {
    throw new Error(
      `expected one public build output for ${target}, found ${matches.length}\n${output.slice(-8000)}`,
    );
  }
  return path.join(workspaceRoot, matches[0]);
}
