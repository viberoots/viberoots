import path from "node:path";

type ZxShell = any;
type ZxResult = any;

function graphJsonPath(tmp: string): string {
  return path.join(tmp, "build-tools", "tools", "buck", "graph.json");
}

function selectedBuildEnv(args: {
  tmp: string;
  target?: string;
  env?: Record<string, string>;
}): Record<string, string> {
  const { tmp, target, env } = args;
  return {
    ...process.env,
    WORKSPACE_ROOT: tmp,
    BUCK_TEST_SRC: tmp,
    BUCK_GRAPH_JSON: graphJsonPath(tmp),
    ...(target ? { BUCK_TARGET: target } : {}),
    ...(env || {}),
  };
}

export async function exportGraphInTemp(args: {
  tmp: string;
  $: ZxShell;
  env?: Record<string, string>;
  stdio?: "inherit" | "pipe";
}): Promise<ZxResult> {
  const { tmp, $, env, stdio = "inherit" } = args;
  return await $({
    cwd: tmp,
    stdio,
    env: selectedBuildEnv({ tmp, env }),
  })`${process.execPath} --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
}

export async function runBuildSelected(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  env?: Record<string, string>;
  stdio?: "inherit" | "pipe";
  reject?: boolean;
  nothrow?: boolean;
}): Promise<ZxResult> {
  const { tmp, $, target, env, stdio = "pipe", reject = false, nothrow = true } = args;
  return await $({
    cwd: tmp,
    stdio,
    reject,
    nothrow,
    env: selectedBuildEnv({ tmp, target, env }),
  })`${process.execPath} --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs build-tools/tools/dev/build-selected.ts`;
}

export async function buildSelectedOutPath(args: {
  tmp: string;
  $: ZxShell;
  target: string;
  env?: Record<string, string>;
}): Promise<string> {
  const { tmp, $, target, env } = args;
  const res = await runBuildSelected({ tmp, $, target, env, stdio: "pipe" });
  if (Number(res.exitCode || 0) !== 0) {
    const combined = `${String(res.stdout || "")}\n${String(res.stderr || "")}`.trim();
    throw new Error(`build-selected.ts failed for ${target}\n${combined}`);
  }
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\n+/)
      .pop() || "";
  if (!outPath) throw new Error(`no out path from build-selected.ts for ${target}`);
  return outPath;
}
