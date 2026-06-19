import path from "node:path";
import * as fsp from "node:fs/promises";
import { getArgvTokens } from "../../lib/cli";
import { normalizeDevBuildTargetArgs } from "../dev-build/target-args";
import { parseVerifyExecutionPolicy, type VerifyExecutionPolicy } from "./remote-policy";

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

const ROOT_ZX_TEST_PREFIX = "build-tools/tools/tests/";
const ROOT_ZX_TEST_EXTRA_FILES = new Set(["build-tools/tools/tests/e2e-provider-wiring.ts"]);

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

export function parseVerifyExecutionPolicyForArgs(opts: {
  args: Pick<VerifyArgs, "coverage">;
  env?: NodeJS.ProcessEnv;
}): VerifyExecutionPolicy {
  return parseVerifyExecutionPolicy({
    env: opts.env,
    coverage: opts.args.coverage,
  });
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
  const out: string[] = [];
  for (const [i, t] of normalized.entries()) {
    const original = String(opts.targets[i] || "").trim();
    const normalizedTarget = String(t || "").trim();
    const rootZxLabel = await resolveRootZxTestLabel({
      workspaceRoot: opts.workspaceRoot,
      baseDir: opts.baseDir,
      original,
    });
    if (rootZxLabel) {
      out.push(rootZxLabel);
      continue;
    }
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
    if (!looksPathLike) {
      out.push(normalizedTarget);
      continue;
    }
    if (normalizedTarget === "." && (original === "." || original === "./")) {
      const baseAbs = path.resolve(opts.baseDir);
      const rootAbs = path.resolve(opts.workspaceRoot);
      if (baseAbs === rootAbs) {
        out.push("//...");
        continue;
      }
    }
    if (!normalizedTarget.startsWith("//")) {
      out.push(normalizedTarget);
      continue;
    }
    if (normalizedTarget.includes("...")) {
      out.push(normalizedTarget);
      continue;
    }
    const pkg = normalizedTarget.split(":")[0];
    if (!pkg || !pkg.startsWith("//")) {
      out.push(normalizedTarget);
      continue;
    }
    out.push(`${pkg}/...`);
  }
  return out;
}

async function resolveRootZxTestLabel(opts: {
  workspaceRoot: string;
  baseDir: string;
  original: string;
}): Promise<string | null> {
  const raw = String(opts.original || "").trim();
  if (!raw || raw.startsWith("//") || raw.startsWith("root//") || raw.startsWith(":")) {
    return null;
  }
  const absPath = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(String(opts.baseDir || opts.workspaceRoot), raw);
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const nestedViberootsRoot = path.join(workspaceRoot, "viberoots");
  let relPath = path.relative(workspaceRoot, absPath);
  let cellPrefix = "";
  let statPath = absPath;
  if (relPath.startsWith(ROOT_ZX_TEST_PREFIX) || ROOT_ZX_TEST_EXTRA_FILES.has(relPath)) {
    const nestedPath = path.join(nestedViberootsRoot, relPath);
    if (await pathExists(nestedPath)) {
      statPath = nestedPath;
      cellPrefix = "viberoots";
    }
  } else if (absPath.startsWith(nestedViberootsRoot + path.sep)) {
    relPath = path.relative(nestedViberootsRoot, absPath);
    cellPrefix = "viberoots";
  }
  if (!relPath || relPath.startsWith("..") || path.isAbsolute(relPath)) return null;
  let stat;
  try {
    stat = await fsp.stat(statPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const relPosix = relPath.replace(/\\/g, "/");
  const isRootZxTest =
    relPosix.startsWith(ROOT_ZX_TEST_PREFIX) &&
    (relPosix.endsWith(".test.ts") || ROOT_ZX_TEST_EXTRA_FILES.has(relPosix));
  if (!isRootZxTest) return null;
  let name = relPosix.slice(ROOT_ZX_TEST_PREFIX.length);
  if (name.endsWith(".ts")) name = name.slice(0, -3);
  if (name.endsWith(".test")) name = name.slice(0, -5);
  return `${cellPrefix}//:${name.replace(/[/.-]/g, "_")}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
