import process from "node:process";
import {
  type TemplateTestSelectorDiagnostics,
  resolveTemplateTestSelection,
} from "../../lib/template-test-selector.ts";
import { resolveBuildSystemBuckTestScope } from "../../lib/build-system-test-scope.ts";
import { packagePathFromLabel } from "../../lib/labels.ts";

export type VerifyTemplateScopeMode = "auto" | "always" | "never";

export type VerifyTemplateScopeDecision = {
  requestedMode: VerifyTemplateScopeMode;
  selectorMode: "template-only" | "mixed" | "no-template-impact" | "skipped";
  targets: string[];
  diagnostics: TemplateTestSelectorDiagnostics | null;
  lintFilters: string[] | null;
  reason: string;
};

export type VerifyTemplateScopeDeps = {
  resolveTemplateSelection: typeof resolveTemplateTestSelection;
  resolveBuildScope: typeof resolveBuildSystemBuckTestScope;
};

function parseVerifyTemplateScopeMode(raw: string | undefined): VerifyTemplateScopeMode {
  const v = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (v === "always") return "always";
  if (v === "never") return "never";
  return "auto";
}

function isDefaultVerifyTargetSet(targets: string[]): boolean {
  return targets.length === 1 && targets[0] === "//...";
}

function lintFiltersFromExplicitTargets(targets: string[]): string[] | null {
  const filters = new Set<string>();
  for (const raw of targets) {
    const t = String(raw || "").trim();
    if (!t || !t.startsWith("//")) return null;
    if (t.includes("*") || t.includes("?") || t.includes("[") || t.includes("]")) {
      return null;
    }
    const pkg =
      t.endsWith("/...") && !t.includes(":") ? t.slice(2, -"/...".length) : packagePathFromLabel(t);
    if (!pkg) return null;
    if (!pkg.startsWith("projects/apps/") && !pkg.startsWith("projects/libs/")) return null;
    filters.add(`./${pkg}`);
  }
  return filters.size > 0 ? Array.from(filters).sort() : null;
}

function emptyTemplateLabelIds(d: TemplateTestSelectorDiagnostics): string[] {
  if (d.mode !== "template-only") return [];
  return d.changedTemplateIds.filter((id) => (d.templateTargetsById[id] || []).length === 0);
}

function guardTemplateSelection(diagnostics: TemplateTestSelectorDiagnostics): void {
  const emptyIds = emptyTemplateLabelIds(diagnostics);
  if (emptyIds.length > 0) {
    throw new Error(
      [
        "template selector guardrail failed: one or more changed template ids have no Buck targets",
        `emptyTemplateIds=${emptyIds.join(",")}`,
        "diagnostics:",
        JSON.stringify(diagnostics, null, 2),
      ].join("\n"),
    );
  }
}

export function summarizeTemplateScopeDecision(d: VerifyTemplateScopeDecision): string {
  const base = `requested=${d.requestedMode} selector=${d.selectorMode} reason=${d.reason}`;
  if (!d.diagnostics) return `${base} targets=${d.targets.length}`;
  return `${base} templates=${d.diagnostics.changedTemplateIds.join(",") || "none"} targets=${d.targets.length}`;
}

export async function resolveVerifyTemplateTestScope(opts: {
  root: string;
  requestedTargets: string[];
  env?: NodeJS.ProcessEnv;
  deps?: Partial<VerifyTemplateScopeDeps>;
}): Promise<VerifyTemplateScopeDecision> {
  const env = opts.env || process.env;
  const requestedMode = parseVerifyTemplateScopeMode(env.BNX_TEMPLATE_TEST_SCOPE);
  const resolveBuildScope = opts.deps?.resolveBuildScope || resolveBuildSystemBuckTestScope;
  const baseScope = await resolveBuildScope({
    root: opts.root,
    requestedTargets: opts.requestedTargets,
    env,
  });

  if (!isDefaultVerifyTargetSet(opts.requestedTargets)) {
    return {
      requestedMode,
      selectorMode: "skipped",
      targets: baseScope.targets,
      diagnostics: null,
      lintFilters: lintFiltersFromExplicitTargets(opts.requestedTargets),
      reason: "explicit-targets",
    };
  }
  if (requestedMode === "never") {
    return {
      requestedMode,
      selectorMode: "skipped",
      targets: baseScope.targets,
      diagnostics: null,
      lintFilters: null,
      reason: "selector-disabled",
    };
  }

  const resolveTemplateSelection =
    opts.deps?.resolveTemplateSelection || resolveTemplateTestSelection;
  const selected = await resolveTemplateSelection({ root: opts.root, env });
  const diagnostics = selected.diagnostics;

  if (requestedMode === "always" && selected.mode !== "template-only") {
    throw new Error(
      [
        "template selector guardrail failed: BNX_TEMPLATE_TEST_SCOPE=always requires template-only changes",
        "diagnostics:",
        JSON.stringify(diagnostics, null, 2),
      ].join("\n"),
    );
  }

  if (selected.mode === "template-only") {
    guardTemplateSelection(diagnostics);
    return {
      requestedMode,
      selectorMode: selected.mode,
      targets: selected.targets,
      diagnostics,
      lintFilters: ["."],
      reason: "template-targeted",
    };
  }

  return {
    requestedMode,
    selectorMode: selected.mode,
    targets: baseScope.targets,
    diagnostics,
    lintFilters: null,
    reason: "fallback-build-system-scope",
  };
}
