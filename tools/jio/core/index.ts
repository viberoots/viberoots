export {
  buildArgv,
  buildChildEnv,
  buildIndex,
  buildShellArgsWithScript,
  computeExecCommand,
  enforceArgvCaps,
  findToolSpecs,
  getEffectiveLimits,
  makeShellSetFlags,
  readRootConfig,
  readSpec,
  resolvePreferredShell,
  resolveRoot,
  runWithTransforms,
  waitProcess,
} from "../runner.ts";

export type { ParameterSpec, RootConfig, ToolSpec } from "../runner.ts";

export {
  createAjvValidator,
  generateInputSchemaFromParameters,
  toJsonSchema,
} from "../schema/index.ts";

export async function discoverJioTools(rootDir?: string) {
  const dir = rootDir || (await (await import("../runner.ts")).resolveRoot());
  const { readRootConfig, buildIndex, readSpec } = await import("../runner.ts");
  const cfg = await readRootConfig(dir);
  const index = await buildIndex(dir, cfg);
  const specs = new Map<string, any>();
  for (const [fq, p] of index) {
    const { spec } = await readSpec(p);
    if (spec) specs.set(fq, spec);
  }
  return { dir, cfg, index, specs };
}
