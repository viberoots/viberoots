import path from "node:path";
import { getArgvTokens } from "../../lib/cli.ts";
import { normalizeDevBuildTargetArgs } from "../dev-build/target-args.ts";

export type VerifyConsole = "auto" | "super" | "simple";
export type VerifySelectorMode = "default" | "project-closure";

export type VerifyArgs = {
  coverage: boolean;
  console: VerifyConsole;
  targets: string[];
  selector: VerifySelectorMode;
  requestedProjects: string[];
  explainSelection: boolean;
};

function parseProjectsCsv(raw: string): string[] {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function parseSelector(raw: string): VerifySelectorMode {
  const normalized = String(raw || "").trim();
  if (!normalized) return "default";
  if (normalized === "project-closure") return normalized;
  throw new Error(`unknown verify selector: ${normalized}`);
}

export function parseVerifyArgs(opts?: {
  argvTokens?: string[];
  env?: NodeJS.ProcessEnv;
}): VerifyArgs {
  const tokens = opts?.argvTokens || getArgvTokens();
  const env = opts?.env || process.env;
  let coverage = false;
  let console: VerifyConsole = "auto";
  let selectorFlag = "";
  let explainSelection = false;
  const projectFlags: string[] = [];
  const passthrough: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] || "";
    if (t === "--") {
      passthrough.push(...tokens.slice(i + 1));
      break;
    }
    if (t === "--coverage") {
      coverage = true;
      continue;
    }
    if (t === "--explain-selection") {
      explainSelection = true;
      continue;
    }
    if (t.startsWith("--selector=")) {
      selectorFlag = t.slice("--selector=".length).trim();
      continue;
    }
    if (t === "--selector") {
      selectorFlag = String(tokens[i + 1] || "").trim();
      i++;
      continue;
    }
    if (t.startsWith("--project=")) {
      projectFlags.push(t.slice("--project=".length).trim());
      continue;
    }
    if (t === "--project") {
      projectFlags.push(String(tokens[i + 1] || "").trim());
      i++;
      continue;
    }
    if (t.startsWith("--projects=")) {
      projectFlags.push(...parseProjectsCsv(t.slice("--projects=".length)));
      continue;
    }
    if (t === "--projects") {
      projectFlags.push(...parseProjectsCsv(String(tokens[i + 1] || "")));
      i++;
      continue;
    }
    if (t.startsWith("--console=")) {
      const v = t.slice("--console=".length).trim();
      if (v === "auto" || v === "super" || v === "simple") console = v;
      continue;
    }
    if (t === "--console") {
      const v = String(tokens[i + 1] || "").trim();
      if (v === "auto" || v === "super" || v === "simple") console = v;
      i++;
      continue;
    }
    // Treat all other flags as verify-internal; only targets should be passed through.
    if (t.startsWith("--")) continue;
    passthrough.push(t);
  }

  const selector = parseSelector(selectorFlag || String(env.VERIFY_SELECTOR || ""));
  const requestedProjects = toSortedUnique(
    projectFlags.length > 0 ? projectFlags : parseProjectsCsv(String(env.VERIFY_PROJECTS || "")),
  );
  const targets = passthrough.length > 0 ? passthrough : ["//..."];

  if (selector === "project-closure" && requestedProjects.length === 0) {
    throw new Error(
      "verify selector 'project-closure' requires at least one --project or --projects value",
    );
  }
  if (selector === "project-closure" && passthrough.length > 0) {
    throw new Error(
      "verify selector 'project-closure' cannot be combined with explicit Buck targets",
    );
  }
  if (selector === "default" && requestedProjects.length > 0) {
    throw new Error(
      "project selectors require '--selector project-closure' or VERIFY_SELECTOR=project-closure",
    );
  }

  return {
    coverage,
    console,
    targets,
    selector,
    requestedProjects,
    explainSelection,
  };
}

export async function normalizeVerifyTargets(opts: {
  workspaceRoot: string;
  baseDir: string;
  targets: string[];
}): Promise<string[]> {
  const normalized = await normalizeDevBuildTargetArgs({
    workspaceRoot: opts.workspaceRoot,
    baseDir: opts.baseDir,
    subcmd: "test",
    args: opts.targets,
  });
  return normalized.map((t, i) => {
    const original = String(opts.targets[i] || "").trim();
    const normalizedTarget = String(t || "").trim();
    const isExplicitBuckLabel =
      original.startsWith("//") || original.startsWith("root//") || original.startsWith(":");
    const looksPathLike =
      !isExplicitBuckLabel &&
      (original === "." ||
        original === ".." ||
        original.startsWith("./") ||
        original.startsWith("../") ||
        original.startsWith("/") ||
        original.includes("/"));
    if (!looksPathLike) return normalizedTarget;
    if (normalizedTarget === "." && (original === "." || original === "./")) {
      const baseAbs = path.resolve(opts.baseDir);
      const rootAbs = path.resolve(opts.workspaceRoot);
      if (baseAbs === rootAbs) return "//...";
    }
    if (!normalizedTarget.startsWith("//")) return normalizedTarget;
    if (normalizedTarget.includes("...")) return normalizedTarget;
    const pkg = normalizedTarget.split(":")[0];
    if (!pkg || !pkg.startsWith("//")) return normalizedTarget;
    return `${pkg}/...`;
  });
}
