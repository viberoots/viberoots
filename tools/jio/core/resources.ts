import fg from "fast-glob";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { createAjv } from "../validation/ajv.ts";

export type ResourceSpec = {
  id: string;
  name: string;
  description?: string;
  file: string; // relative to the .resource.json directory
  mimeType?: string;
  etag?: string; // or "auto"
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

export type ResourceFileMeta = {
  size: number;
  mtimeMs: number;
  etag?: string;
};

const RESOURCE_SCHEMA = {
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

export function validateResourceSpec(obj: any): ResourceSpec {
  const ajv = createAjv();
  const validate = ajv.compile(RESOURCE_SCHEMA as any);
  const ok = validate(obj);
  if (!ok) {
    const err = (validate.errors && validate.errors[0]) || { message: "invalid" };
    throw new Error(`invalid resource spec: ${JSON.stringify(err)}`);
  }
  return obj as ResourceSpec;
}

export async function readResourceSpec(specPath: string): Promise<{
  spec: ResourceSpec | null;
  warning: string | null;
}> {
  try {
    const txt = await fsp.readFile(specPath, "utf8");
    const obj = JSON.parse(txt);
    try {
      const spec = validateResourceSpec(obj);
      return { spec, warning: null };
    } catch (e: any) {
      return {
        spec: null,
        warning: `jio: invalid resource spec skipped: ${specPath}: ${String(e?.message || e)}`,
      };
    }
  } catch (e: any) {
    return {
      spec: null,
      warning: `jio: unreadable resource spec skipped: ${specPath}: ${String(e?.message || e)}`,
    };
  }
}

export function resolveResourcePath(specPath: string, relFile: string): string {
  const specDir = path.dirname(specPath);
  return path.resolve(specDir, relFile);
}

export async function computeResourceMeta(
  absFilePath: string,
  opts?: { etagMode?: "auto" | "none"; explicitEtag?: string } | undefined,
): Promise<ResourceFileMeta> {
  const st = await fsp.stat(absFilePath);
  const size = st.size;
  const mtimeMs = Math.floor(st.mtimeMs);
  let etag: string | undefined = undefined;
  if (opts?.explicitEtag && opts.explicitEtag !== "auto") {
    etag = opts.explicitEtag;
  } else if (opts?.etagMode === "auto") {
    etag = `W/"${mtimeMs}-${size}"`;
  }
  return { size, mtimeMs, etag };
}

export async function buildResourceIndex(rootDir: string): Promise<{
  index: Map<string, DiscoveredResource>;
  warnings: string[];
}> {
  const entries = await fg(["**/*.resource.json"], {
    cwd: rootDir,
    ignore: ["node_modules/**", ".git/**", "buck-out/**", "coverage/**", "dist/**"],
    dot: false,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: true,
  });
  const index = new Map<string, DiscoveredResource>();
  const warnings: string[] = [];
  for (const rel of entries) {
    const specPath = path.resolve(rootDir, rel);
    const { spec, warning } = await readResourceSpec(specPath);
    if (warning) {
      warnings.push(warning);
      continue;
    }
    if (!spec) continue;
    const abs = resolveResourcePath(specPath, spec.file);
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
      absFilePath: abs,
      specPath,
    });
  }
  return { index, warnings };
}

export class ResourceRegistry {
  private rootDir: string;
  private map: Map<string, DiscoveredResource> = new Map();
  private warnings: string[] = [];
  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }
  async refresh(): Promise<void> {
    const { index, warnings } = await buildResourceIndex(this.rootDir);
    this.map = index;
    this.warnings = warnings;
  }
  list(): DiscoveredResource[] {
    return Array.from(this.map.values()).sort((a, b) => a.id.localeCompare(b.id));
  }
  get(id: string): DiscoveredResource | undefined {
    return this.map.get(id);
  }
  getWarnings(): string[] {
    return this.warnings.slice();
  }
  async reloadOne(specPath: string): Promise<void> {
    const { spec, warning } = await readResourceSpec(specPath);
    if (warning) {
      this.warnings.push(warning);
      // If we can derive an id, we could evict; otherwise, leave map as-is.
      return;
    }
    if (!spec) return;
    const abs = resolveResourcePath(specPath, spec.file);
    // Evict any prior record with the same id, then set new
    this.map.set(spec.id, {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      mimeType: spec.mimeType,
      etag: spec.etag,
      cacheControl: spec.cacheControl,
      absFilePath: abs,
      specPath,
    });
  }
  findByFilePath(absFilePath: string): DiscoveredResource[] {
    const want = path.resolve(absFilePath);
    const out: DiscoveredResource[] = [];
    for (const r of this.map.values()) if (path.resolve(r.absFilePath) === want) out.push(r);
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}
