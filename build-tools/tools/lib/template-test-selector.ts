import { collectChangedPaths, isBuildSystemPath } from "./build-system-test-scope.ts";
import { TEMPLATE_TAXONOMY } from "../scaffolding/scaf/templates/generated/template-taxonomy.generated.ts";
import { queryTargetsForTemplateLabel } from "./template-test-selector-query.ts";
import { readTemplateOwnedTestIndex, targetLabelFromScript } from "./template-owned-tests.ts";

export type TemplateTestSelectorMode = "template-only" | "mixed" | "no-template-impact";

export type TemplateTestSelectorDiagnostics = {
  mode: TemplateTestSelectorMode;
  changedPaths: string[];
  changedTemplateIds: string[];
  ownedChangedTestPaths: string[];
  ownedChangedTestTargets: string[];
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
const TEMPLATE_SUPPORT_EXACT = new Set([
  "build-tools/tools/tests/template_conventions.bzl",
  "build-tools/tools/tests/scaffolding/template-conventions.metadata.cquery.test.ts",
  "build-tools/tools/tests/scaffolding/template-conventions.safety-floor.test.ts",
]);
const TEMPLATE_SUPPORT_PREFIXES = ["build-tools/tools/tests/scaffolding/lib/"];

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

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function isCanonicalTemplateId(language: string, template: string): boolean {
  const entries = TEMPLATE_TAXONOMY[language as keyof typeof TEMPLATE_TAXONOMY];
  return Array.isArray(entries) && entries.includes(template as never);
}

function isTemplateSupportBuildSystemPath(relPath: string): boolean {
  if (TEMPLATE_SUPPORT_EXACT.has(relPath)) return true;
  return TEMPLATE_SUPPORT_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

export function templateIdFromPath(relPath: string): string | null {
  const p = normalizePath(relPath);
  const m = TEMPLATE_PATH.exec(p);
  if (!m) return null;
  const language = String(m[1] || "").trim();
  const template = String(m[2] || "").trim();
  if (!language || !template) return null;
  if (!isCanonicalTemplateId(language, template)) return null;
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

export async function classifyTemplateSelectorMode(
  root: string,
  changedPaths: string[],
): Promise<{
  mode: TemplateTestSelectorMode;
  changedTemplateIds: string[];
  ownedChangedTestPaths: string[];
  ownedChangedTestTargets: string[];
  nonTemplateBuildSystemPaths: string[];
}> {
  const normalized = toSortedUnique(changedPaths.map((p) => normalizePath(p)));
  const changedTemplateIds = changedTemplateIdsFromPaths(normalized);
  if (changedTemplateIds.length === 0) {
    return {
      mode: "no-template-impact",
      changedTemplateIds,
      ownedChangedTestPaths: [],
      ownedChangedTestTargets: [],
      nonTemplateBuildSystemPaths: [],
    };
  }
  const changedTemplateIdSet = new Set(changedTemplateIds);
  const ownedIndex = await readTemplateOwnedTestIndex(root);
  const ownedChangedTestPaths: string[] = [];
  const ownedChangedTestTargets: string[] = [];
  const nonTemplateBuildSystemPaths: string[] = [];
  for (const p of normalized) {
    if (!isBuildSystemPath(p)) continue;
    if (p.startsWith(TEMPLATE_ROOT)) continue;
    if (isTemplateSupportBuildSystemPath(p)) continue;
    const ownerTemplateIds = ownedIndex.scriptToTemplateIds.get(p) || [];
    const isOwnedChangedTest =
      ownerTemplateIds.length > 0 && ownerTemplateIds.every((id) => changedTemplateIdSet.has(id));
    if (isOwnedChangedTest) {
      ownedChangedTestPaths.push(p);
      ownedChangedTestTargets.push(targetLabelFromScript(p));
      continue;
    }
    nonTemplateBuildSystemPaths.push(p);
  }
  return {
    mode: nonTemplateBuildSystemPaths.length > 0 ? "mixed" : "template-only",
    changedTemplateIds,
    ownedChangedTestPaths: toSortedUnique(ownedChangedTestPaths),
    ownedChangedTestTargets: toSortedUnique(ownedChangedTestTargets),
    nonTemplateBuildSystemPaths: toSortedUnique(nonTemplateBuildSystemPaths),
  };
}

type SelectorDeps = {
  queryTargetsForTemplateLabel: (root: string, templateId: string) => Promise<string[]>;
};

export async function resolveTemplateTestSelection(opts: {
  root: string;
  changedPaths?: string[];
  env?: NodeJS.ProcessEnv;
  deps?: Partial<SelectorDeps>;
}): Promise<TemplateTestSelectorResult> {
  const env = opts.env || process.env;
  const changedPaths = opts.changedPaths || (await collectChangedPaths(opts.root, env));
  const normalizedPaths = toSortedUnique(changedPaths.map((p) => normalizePath(p)));
  const {
    mode,
    changedTemplateIds,
    ownedChangedTestPaths,
    ownedChangedTestTargets,
    nonTemplateBuildSystemPaths,
  } = await classifyTemplateSelectorMode(opts.root, normalizedPaths);
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
    Object.values(templateTargetsById).flatMap((targets) =>
      targets.map((t) => String(t || "").trim()),
    ),
  );
  const selectedTargets =
    mode === "template-only"
      ? toSortedUnique([
          ...selectedTemplateTargets,
          ...ownedChangedTestTargets,
          ...TEMPLATE_SAFETY_FLOOR_TARGETS,
        ])
      : [];

  return {
    mode,
    targets: selectedTargets,
    diagnostics: {
      mode,
      changedPaths: normalizedPaths,
      changedTemplateIds,
      ownedChangedTestPaths,
      ownedChangedTestTargets,
      nonTemplateBuildSystemPaths,
      safetyFloorTargets: [...TEMPLATE_SAFETY_FLOOR_TARGETS],
      templateTargetsById,
      selectedTargets,
    },
  };
}
