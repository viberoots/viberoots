import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { normalizeTargetLabel } from "../lib/labels";

type GraphNodeLike = {
  name?: string;
  labels?: unknown;
};

function isBuckLabelLike(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (s.startsWith("//") || s.startsWith("root//")) return true;
  if (s.startsWith(":")) return true;
  if (s.includes(" (config//")) return true;
  return false;
}

function toPosixPath(s: string): string {
  return String(s || "").replace(/\\/g, "/");
}

async function normalizeTargetInput(
  workspaceRoot: string,
  target: string,
  opts?: { baseDir?: string },
): Promise<string> {
  const raw = String(target || "").trim();
  if (!raw) return raw;
  if (isBuckLabelLike(raw)) return normalizeTargetLabel(raw);

  const canonicalExistingPath = async (p: string): Promise<string> => {
    try {
      return await fsp.realpath(p);
    } catch {
      return p;
    }
  };
  const canonicalPath = async (p: string): Promise<string> => {
    const abs = path.resolve(p);
    let cur = abs;
    const missing: string[] = [];
    for (;;) {
      try {
        const real = await fsp.realpath(cur);
        return path.join(real, ...missing.reverse());
      } catch {
        const parent = path.dirname(cur);
        if (parent === cur) return abs;
        missing.push(path.basename(cur));
        cur = parent;
      }
    }
  };
  const workspaceCanonical = await canonicalExistingPath(path.resolve(workspaceRoot));
  const baseDirRaw = String(opts?.baseDir || workspaceRoot).trim() || workspaceRoot;
  const baseDirCanonical = await canonicalPath(baseDirRaw);
  const absPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(baseDirCanonical, raw);
  const absCanonical = await canonicalPath(absPath);
  const relToWorkspace = path.relative(workspaceCanonical, absCanonical);
  const outsideWorkspace = relToWorkspace.startsWith("..") || path.isAbsolute(relToWorkspace);
  if (outsideWorkspace) {
    if (path.isAbsolute(raw)) {
      throw new Error(`path is outside workspace root: ${raw}`);
    }
    return normalizeTargetLabel(raw);
  }

  let pkgRel = toPosixPath(relToWorkspace).replace(/\/+$/, "");
  if (!pkgRel || pkgRel === ".") return normalizeTargetLabel(raw);
  try {
    const st = await fsp.stat(absPath);
    if (st.isFile()) {
      pkgRel = toPosixPath(path.dirname(pkgRel)).replace(/\/+$/, "");
      if (!pkgRel || pkgRel === ".") return normalizeTargetLabel(raw);
    }
  } catch {}
  return `//${pkgRel}`;
}

async function readGraphNodes(workspaceRoot: string): Promise<GraphNodeLike[]> {
  const graphTxt = await fsp.readFile(path.join(workspaceRoot, DEFAULT_GRAPH_PATH), "utf8");
  const raw = JSON.parse(graphTxt);
  const nodes = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
  return nodes as GraphNodeLike[];
}

function packageTargetNames(nodes: GraphNodeLike[], pkgLabel: string): string[] {
  const prefix = `${pkgLabel}:`;
  const out = new Set<string>();
  for (const n of nodes) {
    const name = normalizeTargetLabel(String(n?.name || ""));
    if (name.startsWith(prefix)) out.add(name);
  }
  return Array.from(out).sort();
}

function isRunnableGraphNode(n: GraphNodeLike): boolean {
  const labels = Array.isArray(n?.labels) ? n.labels.map((x) => String(x || "")) : [];
  if (labels.includes("kind:app") || labels.includes("kind:bin")) return true;
  if (labels.includes("webapp:ssr") || labels.includes("webapp:static")) return true;
  return false;
}

export async function resolveSelectedTargetLabel(
  workspaceRoot: string,
  target: string,
  opts?: { baseDir?: string; preferredTargetName?: string },
): Promise<string> {
  const normalized = (await normalizeTargetInput(workspaceRoot, target, opts)).trim();
  if (!normalized.startsWith("//") || normalized.includes(":")) return normalized;
  try {
    const names = packageTargetNames(await readGraphNodes(workspaceRoot), normalized);
    const preferred = `${normalized}:${opts?.preferredTargetName || "app"}`;
    if (names.includes(preferred)) return preferred;
    if (names.length === 1) return names[0];
    if (names.length > 1) {
      throw new Error(
        `target ${normalized} is ambiguous; use an explicit label (${names.join(", ")})`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("is ambiguous;")) throw err;
  }
  return normalized;
}

export async function resolveRunnableTargetLabel(
  workspaceRoot: string,
  target: string,
  opts?: { baseDir?: string },
): Promise<string> {
  const normalized = (await normalizeTargetInput(workspaceRoot, target, opts)).trim();
  if (!normalized.startsWith("//") || normalized.includes(":")) return normalized;
  try {
    const nodes = await readGraphNodes(workspaceRoot);
    const runnable = nodes
      .filter((n) => isRunnableGraphNode(n))
      .map((n) => normalizeTargetLabel(String(n?.name || "")))
      .filter((n) => n.startsWith(`${normalized}:`))
      .filter(Boolean)
      .sort();
    const preferred = `${normalized}:app`;
    if (runnable.includes(preferred)) return preferred;
    if (runnable.length === 1) return runnable[0];
    if (runnable.length > 1) {
      throw new Error(
        `target ${normalized} is ambiguous; use an explicit label (${runnable.join(", ")})`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("is ambiguous;")) throw err;
  }
  return `${normalized}:app`;
}
