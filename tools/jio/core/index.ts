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

// New: resource discovery exports (6.1)
export type ResourceSpec = {
  id: string;
  name: string;
  description?: string;
  file: string; // resolved relative to the .resource.json directory
  mimeType?: string;
  etag?: string;
  cacheControl?: string;
};

export type DiscoveredResource = {
  id: string;
  name: string;
  description?: string;
  mimeType?: string;
  etag?: string;
  cacheControl?: string;
  absFilePath: string;
  specPath: string;
};

export async function discoverResources(rootDir?: string): Promise<{
  index: Map<string, DiscoveredResource>;
  warnings: string[];
}> {
  const { resolveRoot } = await import("./discovery.ts");
  const dir = rootDir || (await resolveRoot());
  const { default: fg } = await import("fast-glob");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const { createAjv } = await import("../validation/ajv.ts");

  const warnings: string[] = [];
  const entries = await fg(["**/*.resource.json"], {
    cwd: dir,
    ignore: ["node_modules/**", ".git/**", "buck-out/**", "coverage/**", "dist/**"],
    dot: false,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: true,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "file"],
    properties: {
      id: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
      file: { type: "string", minLength: 1 },
      mimeType: { type: "string", minLength: 1 },
      etag: { type: "string", minLength: 1 },
      cacheControl: { type: "string", minLength: 1 },
    },
  } as const;
  const ajv = createAjv();
  const validate = ajv.compile(schema as any);

  const index = new Map<string, DiscoveredResource>();
  for (const rel of entries) {
    const specPath = path.resolve(dir, rel);
    let obj: any;
    try {
      const txt = await fs.readFile(specPath, "utf8");
      obj = JSON.parse(txt);
    } catch (e: any) {
      warnings.push(
        `jio: unreadable resource spec skipped: ${specPath}: ${String(e?.message || e)}`,
      );
      continue;
    }
    if (!validate(obj)) {
      const first = (validate.errors && validate.errors[0]) || { message: "invalid" };
      warnings.push(`jio: invalid resource spec skipped: ${specPath}: ${JSON.stringify(first)}`);
      continue;
    }
    const spec: ResourceSpec = obj;
    // Resolve file path relative to the spec file directory (allow outside repo if user configured)
    const specDir = path.dirname(specPath);
    const absFilePath = path.resolve(specDir, spec.file);
    if (index.has(spec.id)) {
      const prev = index.get(spec.id) as DiscoveredResource;
      throw new Error(
        `jio: config error — duplicate resource id '${spec.id}' found in:\n  - ${prev.specPath}\n  - ${specPath}`,
      );
    }
    index.set(spec.id, {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      mimeType: spec.mimeType,
      etag: spec.etag,
      cacheControl: spec.cacheControl,
      absFilePath,
      specPath,
    });
  }
  return { index, warnings };
}
