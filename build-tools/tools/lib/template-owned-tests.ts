import * as fsp from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRootsSync } from "./repo";

const TEMPLATE_CONVENTIONS_PATH = "build-tools/tools/tests/template_conventions.bzl";

type TemplateOwnedTestIndex = {
  scriptToTemplateIds: Map<string, string[]>;
};

const cachedOwnedTestIndexes = new Map<string, TemplateOwnedTestIndex>();

function normalizePath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function targetNameFromScript(scriptPath: string): string {
  let name = scriptPath;
  const prefix = "build-tools/tools/tests/";
  if (name.startsWith(prefix)) name = name.slice(prefix.length);
  if (name.endsWith(".ts")) name = name.slice(0, -3);
  if (name.endsWith(".test")) name = name.slice(0, -5);
  return name.replace(/[/.-]/g, "_");
}

export function targetLabelFromScript(scriptPath: string): string {
  return `//:${targetNameFromScript(scriptPath)}`;
}

function templateIdFromTemplateRoot(rootPath: string): string | null {
  const normalized = normalizePath(rootPath).replace(/\/+$/, "");
  const prefix = "build-tools/tools/scaffolding/templates/";
  if (!normalized.startsWith(prefix)) return null;
  const rel = normalized.slice(prefix.length);
  const parts = rel.split("/");
  if (parts.length !== 2) return null;
  const language = parts[0]?.trim();
  const template = parts[1]?.trim();
  if (!language || !template) return null;
  return `${language}/${template}`;
}

export async function readTemplateOwnedTestIndex(root: string): Promise<TemplateOwnedTestIndex> {
  const roots = resolveWorkspaceRootsSync({ start: root });
  const candidates = [
    roots.viberootsRoot,
    path.join(roots.workspaceRoot, "viberoots"),
    roots.workspaceRoot,
  ];
  let filePath = "";
  for (const candidate of candidates) {
    const p = path.join(candidate, TEMPLATE_CONVENTIONS_PATH);
    try {
      await fsp.access(p);
      filePath = p;
      break;
    } catch {}
  }
  if (!filePath) {
    filePath = path.join(roots.viberootsRoot, TEMPLATE_CONVENTIONS_PATH);
  }
  if (cachedOwnedTestIndexes.has(filePath)) return cachedOwnedTestIndexes.get(filePath)!;
  const text = await fsp.readFile(filePath, "utf8");
  const scriptToTemplateIds = new Map<string, string[]>();
  const lines = text.split(/\r?\n/);
  let currentScriptPath = "";
  let inTemplateRoots = false;
  let currentTemplateIds: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const keyMatch = line.match(/^"([^"]+)":\s*\{$/);
    if (keyMatch) {
      currentScriptPath = normalizePath(keyMatch[1] || "");
      currentTemplateIds = [];
      inTemplateRoots = false;
      continue;
    }
    if (!currentScriptPath) continue;
    if (!inTemplateRoots && line.startsWith('"template_roots": [')) {
      const inlineRoots = Array.from(line.matchAll(/"([^"]+)"/g))
        .map((m) => String(m[1] || ""))
        .filter((v) => v !== "template_roots");
      for (const rootPath of inlineRoots) {
        const templateId = templateIdFromTemplateRoot(rootPath);
        if (templateId) currentTemplateIds.push(templateId);
      }
      inTemplateRoots = !line.includes("],");
      continue;
    }
    if (inTemplateRoots) {
      if (line.startsWith("],")) {
        inTemplateRoots = false;
        continue;
      }
      const rootMatch = line.match(/"([^"]+)"/);
      if (rootMatch) {
        const templateId = templateIdFromTemplateRoot(rootMatch[1] || "");
        if (templateId) currentTemplateIds.push(templateId);
      }
      continue;
    }
    if (line.startsWith("},")) {
      scriptToTemplateIds.set(currentScriptPath, toSortedUnique(currentTemplateIds));
      currentScriptPath = "";
      currentTemplateIds = [];
      inTemplateRoots = false;
    }
  }
  const index = { scriptToTemplateIds };
  cachedOwnedTestIndexes.set(filePath, index);
  return index;
}
