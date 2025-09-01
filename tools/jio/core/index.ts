export { getEffectiveLimits } from "../runner.ts";
export { buildArgv, enforceArgvCaps } from "./argv.ts";
export {
  buildIndex,
  findToolSpecs,
  readRootConfig,
  readSpec,
  resolveRoot,
  resolveToolRef,
} from "./discovery.ts";
export {
  buildChildEnv,
  buildShellArgsWithScript,
  computeExecCommand,
  makeShellSetFlags,
  resolvePreferredShell,
} from "./env.ts";
export { openFailureSink, runWithTransforms, waitProcess } from "./run.ts";

export type { ParameterSpec, RootConfig, ToolSpec } from "../runner.ts";

export {
  createAjvValidator,
  generateInputSchemaFromParameters,
  toJsonSchema,
} from "../schema/index.ts";

export async function discoverJioTools(rootDir?: string) {
  const { resolveRoot, readRootConfig, buildIndex, readSpec } = await import("./discovery.ts");
  const dir = rootDir || (await resolveRoot());
  const cfg = await readRootConfig(dir);
  const index = await buildIndex(dir, cfg);
  const specs = new Map<string, any>();
  for (const [fq, p] of index) {
    const { spec } = await readSpec(p);
    if (spec) specs.set(fq, spec);
  }
  return { dir, cfg, index, specs };
}
