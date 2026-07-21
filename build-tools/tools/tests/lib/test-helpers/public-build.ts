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
  const targetFragment = args.target.replace(/^\/\//, "//");
  for (const line of output.trim().split(/\n+/).reverse()) {
    if (!line.includes(targetFragment) || !line.includes("buck-out/")) continue;
    const outPath = line.trim().split(/\s+/).pop() || "";
    if (outPath) return path.isAbsolute(outPath) ? outPath : path.join(args.tmp, outPath);
  }
  throw new Error(`no public build output for ${args.target}\n${output.slice(-8000)}`);
}
