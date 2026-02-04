import * as fsp from "node:fs/promises";
import path from "node:path";
import { getImporterRootsContract } from "./importer-roots.ts";
import { normalizeTargetLabel } from "./labels.ts";
import { toPosixPath, uniqSorted } from "./posix-path.ts";

export type WorkspaceMap = Record<string, string>;

export type TargetBlock = {
  macro: string;
  name: string;
  start: number;
  end: number;
  nameLine: number;
  depsStart: number | null;
  depsEnd: number | null;
  depsIndent: string;
  nameIndent: string;
  blockIndent: string;
  depsItems: string[];
};

const NODE_MACROS = new Set([
  "nix_node_gen",
  "nix_node_lib",
  "nix_node_bin",
  "nix_node_test",
  "node_webapp",
  "nix_node_cli_bin",
]);

function countChar(line: string, ch: string): number {
  return Array.from(line).filter((c) => c === ch).length;
}

function readIndent(line: string): string {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

function parseDepsLines(lines: string[]): { items: string[] } {
  const joined = lines.join("\n");
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
  const items: string[] = [];
  for (const m of joined.matchAll(re)) {
    const val = m[1] ?? m[2];
    if (val) items.push(val);
  }
  return { items };
}

export function parseTargets(text: string): { lines: string[]; blocks: TargetBlock[] } {
  const lines = text.split("\n");
  const blocks: TargetBlock[] = [];
  let cur: TargetBlock | null = null;
  let depth = 0;
  let depsDepth = 0;
  let depsLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!cur) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*\(/);
      if (m && NODE_MACROS.has(m[1])) {
        cur = {
          macro: m[1],
          name: "",
          start: i,
          end: i,
          nameLine: -1,
          depsStart: null,
          depsEnd: null,
          depsIndent: "",
          nameIndent: "",
          blockIndent: readIndent(line),
          depsItems: [],
        };
        depth = countChar(line, "(") - countChar(line, ")");
      }
    } else {
      depth += countChar(line, "(") - countChar(line, ")");
    }

    if (cur) {
      cur.end = i;
      if (cur.nameLine < 0) {
        const m = line.match(/^\s*name\s*=\s*["']([^"']+)["']\s*,?\s*$/);
        if (m) {
          cur.name = m[1];
          cur.nameLine = i;
          cur.nameIndent = readIndent(line);
        }
      }
      if (cur.depsStart === null) {
        const m = line.match(/^\s*deps\s*=\s*\[/);
        if (m) {
          cur.depsStart = i;
          cur.depsIndent = readIndent(line);
          depsLines = [line];
          depsDepth = countChar(line, "[") - countChar(line, "]");
          if (depsDepth === 0) {
            cur.depsEnd = i;
            const parsed = parseDepsLines(depsLines);
            cur.depsItems = parsed.items;
          }
        }
      } else if (cur.depsEnd === null) {
        depsLines.push(line);
        depsDepth += countChar(line, "[") - countChar(line, "]");
        if (depsDepth === 0) {
          cur.depsEnd = i;
          const parsed = parseDepsLines(depsLines);
          cur.depsItems = parsed.items;
        }
      }
      if (depth <= 0) {
        blocks.push(cur);
        cur = null;
        depth = 0;
        depsDepth = 0;
        depsLines = [];
      }
    }
  }

  return { lines, blocks };
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const txt = await fsp.readFile(filePath, "utf8");
  return JSON.parse(txt) as T;
}

export async function loadWorkspaceMap(root: string): Promise<WorkspaceMap> {
  const mapPath = path.join(root, "build-tools", "tools", "node", "workspace-map.json");
  let raw: unknown;
  try {
    raw = await readJsonFile<unknown>(mapPath);
  } catch (e) {
    throw new Error(`workspace-map missing or invalid at ${mapPath}: ${String(e)}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`workspace-map must be a JSON object: ${mapPath}`);
  }
  const out: WorkspaceMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    if (!k.trim() || !v.trim()) continue;
    out[k.trim()] = v.trim();
  }
  return out;
}

export async function listImporters(root: string): Promise<string[]> {
  const { workspaceRoots } = getImporterRootsContract();
  const out: string[] = [];
  for (const base of workspaceRoots) {
    const baseAbs = path.join(root, base);
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(baseAbs);
    } catch {
      entries = [];
    }
    for (const d of entries) {
      const abs = path.join(baseAbs, d);
      try {
        const st = await fsp.stat(abs);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }
      try {
        await fsp.access(path.join(abs, "package.json"));
      } catch {
        continue;
      }
      out.push(toPosixPath(path.posix.join(base, d)));
    }
  }
  return uniqSorted(out);
}

export function collectDeps(pkg: any): Array<{ name: string; spec: string }> {
  const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const out: Array<{ name: string; spec: string }> = [];
  for (const field of fields) {
    const deps = pkg?.[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps)) {
      out.push({ name, spec: String(spec ?? "") });
    }
  }
  return out;
}

export function expectedWorkspaceDeps(
  deps: Array<{ name: string; spec: string }>,
  map: WorkspaceMap,
): { expected: string[]; missingMap: string[] } {
  const expected: string[] = [];
  const missingMap: string[] = [];
  for (const dep of deps) {
    const mapped = map[dep.name];
    if (mapped) {
      expected.push(normalizeTargetLabel(mapped));
    } else if (dep.spec.trim().startsWith("workspace:")) {
      missingMap.push(dep.name);
    }
  }
  return { expected: uniqSorted(expected), missingMap: uniqSorted(missingMap) };
}

export function formatDeps(indent: string, deps: string[]): string[] {
  if (deps.length === 0) return [];
  const inner = indent + "  ";
  return [`${indent}deps = [`, ...deps.map((d) => `${inner}"${d}",`), `${indent}],`];
}

export function applyEdits(
  lines: string[],
  edits: Array<{ start: number; end: number; newLines: string[] }>,
): string[] {
  const sorted = edits.sort((a, b) => b.start - a.start);
  for (const edit of sorted) {
    const removeCount = edit.end >= edit.start ? edit.end - edit.start + 1 : 0;
    lines.splice(edit.start, removeCount, ...edit.newLines);
  }
  return lines;
}
