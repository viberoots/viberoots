import { isGeneratedRepoStateRelPath } from "./generated-repo-state";

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/");
}

export function targetPackageFromLabel(target: string): string {
  const value = String(target || "").trim();
  const normalized = value.startsWith("root//") ? `//${value.slice("root//".length)}` : value;
  if (!normalized.startsWith("//")) return "";
  const body = normalized.slice(2);
  const separator = body.indexOf(":");
  return separator >= 0 ? body.slice(0, separator) : body;
}

function isAlwaysRelevant(path: string): boolean {
  if (["flake.nix", "flake.lock", ".buckconfig", "BUCK", "TARGETS"].includes(path)) return true;
  if (/\/TARGETS$/.test(path) || path.endsWith(".bzl")) return true;
  return [
    "build-tools/lang/",
    "build-tools/node/",
    "build-tools/tools/buck/",
    "build-tools/tools/nix/",
    "build-tools/tools/dev/",
    "viberoots/build-tools/lang/",
    "viberoots/build-tools/node/",
    "viberoots/build-tools/tools/buck/",
    "viberoots/build-tools/tools/nix/",
    "viberoots/build-tools/tools/dev/",
    "third_party/",
    "toolchains/",
    "viberoots/third_party/",
    "viberoots/toolchains/",
  ].some((prefix) => path.startsWith(prefix));
}

function isIgnoredForExplicitTarget(path: string): boolean {
  return [
    "docs/",
    "build-tools/docs/",
    "build-tools/tools/tests/",
    "viberoots/build-tools/docs/",
    "viberoots/build-tools/tools/tests/",
    ".cursor/",
  ].some((prefix) => path.startsWith(prefix));
}

export function untrackedRequiresImpureForTargets(opts: {
  untracked: string[];
  targetPackages: string[];
}): { requiresImpure: boolean; relevant: string[]; ignored: string[] } {
  const relevant: string[] = [];
  const ignored: string[] = [];
  for (const raw of opts.untracked) {
    const path = normalizePath(raw);
    if (!path) continue;
    if (isGeneratedRepoStateRelPath(path)) {
      ignored.push(path);
      continue;
    }
    const targetRelevant = opts.targetPackages.some(
      (pkg) => path === pkg || path.startsWith(`${pkg}/`),
    );
    if (isAlwaysRelevant(path) || targetRelevant) relevant.push(path);
    else if (isIgnoredForExplicitTarget(path)) ignored.push(path);
    else relevant.push(path);
  }
  return { requiresImpure: relevant.length > 0, relevant, ignored };
}

export function parseUntrackedInventory(output: string): string[] {
  if (!output) return [];
  if (!output.endsWith("\0")) throw new Error("git untracked inventory returned truncated records");
  const records = output.slice(0, -1).split("\0");
  if (records.some((record) => !record)) {
    throw new Error("git untracked inventory returned an empty path record");
  }
  return records;
}

export async function inspectArtifactSource(opts: {
  targetPackages: string[];
  runGit: () => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}): Promise<{ localDevelopment: boolean; relevant: string[]; ignored: string[] }> {
  const result = await opts.runGit();
  if (result.exitCode !== 0) {
    const detail = String(result.stderr || result.stdout).trim() || "unknown git error";
    throw new Error(`artifact source inventory failed: ${detail}`);
  }
  const decision = untrackedRequiresImpureForTargets({
    untracked: parseUntrackedInventory(result.stdout),
    targetPackages: opts.targetPackages,
  });
  return {
    localDevelopment: decision.requiresImpure,
    relevant: decision.relevant,
    ignored: decision.ignored,
  };
}
