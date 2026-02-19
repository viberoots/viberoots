import process from "node:process";
import "zx/globals";
import { collectChangedPaths, isBuildSystemPath } from "./build-system-test-scope.ts";

export type TemplateTestSelectorMode = "template-only" | "mixed" | "no-template-impact";

export type TemplateTestSelectorDiagnostics = {
  mode: TemplateTestSelectorMode;
  changedPaths: string[];
  changedTemplateIds: string[];
  nonTemplateBuildSystemPaths: string[];
  safetyFloorTargets: string[];
  templateTargetsById: Record<string, string[]>;
  selectedTargets: string[];
};

export type TemplateTestSelectorResult = {
  mode: TemplateTestSelectorMode;
  targets: string[];
  diagnostics: TemplateTestSelectorDiagnostics;
};

const TEMPLATE_ROOT = "build-tools/tools/scaffolding/templates/";
const TEMPLATE_PATH = /^build-tools\/tools\/scaffolding\/templates\/([^/]+)\/([^/]+)(?:\/|$)/;
const CONFIG_SUFFIX = /\s+\([^)]*\)$/;

export const TEMPLATE_SAFETY_FLOOR_TARGETS = [
  "//:scaffolding_smoke_lib_readme",
  "//:scaffolding_smoke_cli_readme",
  "//:scaffolding_python_wasm_app_scaffold_smoke",
] as const;

function normalizePath(relPath: string): string {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
}

function normalizeTarget(target: string): string {
  const clean = String(target || "")
    .trim()
    .replace(CONFIG_SUFFIX, "");
  if (!clean) return "";
  if (clean.startsWith("root//")) return clean.slice("root".length);
  return clean;
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

export function templateIdFromPath(relPath: string): string | null {
  const p = normalizePath(relPath);
  const m = TEMPLATE_PATH.exec(p);
  if (!m) return null;
  const language = String(m[1] || "").trim();
  const template = String(m[2] || "").trim();
  if (!language || !template) return null;
  return `${language}/${template}`;
}

export function changedTemplateIdsFromPaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const id = templateIdFromPath(p);
    if (id) out.push(id);
  }
  return toSortedUnique(out);
}

export function classifyTemplateSelectorMode(changedPaths: string[]): {
  mode: TemplateTestSelectorMode;
  changedTemplateIds: string[];
  nonTemplateBuildSystemPaths: string[];
} {
  const normalized = toSortedUnique(changedPaths.map((p) => normalizePath(p)));
  const changedTemplateIds = changedTemplateIdsFromPaths(normalized);
  if (changedTemplateIds.length === 0) {
    return { mode: "no-template-impact", changedTemplateIds, nonTemplateBuildSystemPaths: [] };
  }
  const nonTemplateBuildSystemPaths: string[] = [];
  for (const p of normalized) {
    if (!isBuildSystemPath(p)) continue;
    if (p.startsWith(TEMPLATE_ROOT)) continue;
    nonTemplateBuildSystemPaths.push(p);
  }
  return {
    mode: nonTemplateBuildSystemPaths.length > 0 ? "mixed" : "template-only",
    changedTemplateIds,
    nonTemplateBuildSystemPaths: toSortedUnique(nonTemplateBuildSystemPaths),
  };
}

type SelectorDeps = {
  queryTargetsForTemplateLabel: (root: string, templateId: string) => Promise<string[]>;
};

async function queryTargetsForTemplateLabel(root: string, templateId: string): Promise<string[]> {
  const isolationDir = `template_selector_${process.pid}_${Date.now()}`;
  const query = `attrfilter(labels, "template:${templateId}", //...)`;
  const targetPlatform =
    String(process.env.BUCK_TARGET_PLATFORMS || process.env.BUCK_TARGET_PLATFORM || "").trim() ||
    "prelude//platforms:default";
  try {
    const out = await $({
      cwd: root,
      stdio: "pipe",
      reject: false,
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms ${targetPlatform} ${query} --json --output-attribute name`;
    if ((out as any).exitCode !== 0) {
      return [];
    }
    const raw = JSON.parse(String((out as any).stdout || "{}")) as Record<
      string,
      { name?: string }
    >;
    return toSortedUnique(Object.keys(raw).map((k) => normalizeTarget(k)));
  } finally {
    await $({
      cwd: root,
      stdio: "ignore",
      reject: false,
      env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    })`buck2 --isolation-dir ${isolationDir} kill`;
  }
}

export async function resolveTemplateTestSelection(opts: {
  root: string;
  changedPaths?: string[];
  env?: NodeJS.ProcessEnv;
  deps?: Partial<SelectorDeps>;
}): Promise<TemplateTestSelectorResult> {
  const env = opts.env || process.env;
  const changedPaths = opts.changedPaths || (await collectChangedPaths(opts.root, env));
  const normalizedPaths = toSortedUnique(changedPaths.map((p) => normalizePath(p)));
  const { mode, changedTemplateIds, nonTemplateBuildSystemPaths } =
    classifyTemplateSelectorMode(normalizedPaths);
  const templateTargetsById: Record<string, string[]> = {};
  const queryByLabel = opts.deps?.queryTargetsForTemplateLabel || queryTargetsForTemplateLabel;

  if (mode === "template-only") {
    await Promise.all(
      changedTemplateIds.map(async (id) => {
        templateTargetsById[id] = await queryByLabel(opts.root, id);
      }),
    );
  } else {
    for (const id of changedTemplateIds) {
      templateTargetsById[id] = [];
    }
  }

  const selectedTemplateTargets = toSortedUnique(
    Object.values(templateTargetsById).flatMap((targets) => targets.map((t) => normalizeTarget(t))),
  );
  const selectedTargets =
    mode === "template-only"
      ? toSortedUnique([...selectedTemplateTargets, ...TEMPLATE_SAFETY_FLOOR_TARGETS])
      : [];

  return {
    mode,
    targets: selectedTargets,
    diagnostics: {
      mode,
      changedPaths: normalizedPaths,
      changedTemplateIds,
      nonTemplateBuildSystemPaths,
      safetyFloorTargets: [...TEMPLATE_SAFETY_FLOOR_TARGETS],
      templateTargetsById,
      selectedTargets,
    },
  };
}
