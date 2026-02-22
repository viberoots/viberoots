import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { ensureGraph } from "../buck/glue-run.ts";
import { runNixBuildWithProgress } from "./run-runnable-nix.ts";
import { untrackedRequiresImpureForTargets } from "./dev-build/untracked.ts";
import { makeFilteredFlakeRef } from "./filtered-flake.ts";

function lastOutPath(stdout: string, err: string): string {
  const outPath =
    String(stdout || "")
      .trim()
      .split(/\n+/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath) throw new Error(err);
  return outPath;
}

function targetPackageFromLabel(target: string): string {
  const t = String(target || "").trim();
  const noCell = t.startsWith("root//") ? t.slice("root//".length - 2) : t;
  if (!noCell.startsWith("//")) return "";
  const body = noCell.slice(2);
  const idx = body.indexOf(":");
  return idx >= 0 ? body.slice(0, idx) : body;
}

async function chooseFlakeRef(opts: {
  workspaceRoot: string;
  target?: string;
  sourceMode: "auto" | "git" | "path";
  attr: "graph-generator" | "graph-generator-selected";
}): Promise<{ flakeRef: string; cleanup?: () => Promise<void> }> {
  if (opts.sourceMode === "path") return { flakeRef: `path:${opts.workspaceRoot}#${opts.attr}` };
  if (opts.sourceMode === "git") return { flakeRef: `${opts.workspaceRoot}#${opts.attr}` };

  try {
    const { stdout } = await $({
      stdio: "pipe",
      cwd: opts.workspaceRoot,
    })`git ls-files --others --exclude-standard`;
    const untracked = String(stdout || "")
      .trim()
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (untracked.length === 0) return { flakeRef: `${opts.workspaceRoot}#${opts.attr}` };

    const targetPackages = opts.target ? [targetPackageFromLabel(opts.target)].filter(Boolean) : [];
    const decision = untrackedRequiresImpureForTargets({ untracked, targetPackages });
    if (!decision.requiresImpure) return { flakeRef: `${opts.workspaceRoot}#${opts.attr}` };

    console.warn(
      "[run-runnable] Falling back to path flake source due to relevant untracked files:",
    );
    for (const f of decision.relevant.slice(0, 50)) console.warn(` - ${f}`);
    if (decision.relevant.length > 50) {
      console.warn(` ... and ${decision.relevant.length - 50} more`);
    }
    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: opts.workspaceRoot,
      attr: opts.attr,
      logPrefix: "[run-runnable]",
    });
    return { flakeRef: filtered.flakeRef, cleanup: filtered.cleanup };
  } catch {
    return { flakeRef: `${opts.workspaceRoot}#${opts.attr}` };
  }
}

export async function buildRunnableManifest(
  workspaceRoot: string,
  opts?: { sourceMode?: "auto" | "git" | "path"; target?: string },
): Promise<string> {
  const sourceMode = opts?.sourceMode || "auto";
  const source = await chooseFlakeRef({
    workspaceRoot,
    sourceMode,
    target: opts?.target,
    attr: "graph-generator",
  });
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  process.env.BUCK_TEST_SRC = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.BUCK_GRAPH_JSON = graphPath;
  await ensureGraph();
  const stdout = await (async () => {
    try {
      return await runNixBuildWithProgress({
        workspaceRoot,
        label: "build runnable manifest",
        args: [
          "--impure",
          "--no-write-lock-file",
          "--option",
          "eval-cache",
          "false",
          source.flakeRef,
          "--accept-flake-config",
          "--no-link",
          "--print-out-paths",
          "-L",
        ],
      });
    } finally {
      await source.cleanup?.();
    }
  })();
  const outPath = lastOutPath(stdout, "graph-generator did not emit an output path");
  const linkDir = path.join(workspaceRoot, "buck-out", "tmp");
  const linkPath = path.join(linkDir, "runnable-manifest-current");
  await fsp.mkdir(linkDir, { recursive: true });
  try {
    await fsp.rm(linkPath, { recursive: true, force: true });
  } catch {}
  await fsp.symlink(outPath, linkPath);
  return path.join(linkPath, "manifest.json");
}

export async function buildSelectedOutPath(
  workspaceRoot: string,
  target: string,
  sourceMode: "auto" | "git" | "path" = "auto",
  label: string = `build selected target ${target}`,
): Promise<string> {
  const source = await chooseFlakeRef({
    workspaceRoot,
    sourceMode,
    target,
    attr: "graph-generator-selected",
  });
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  process.env.BUCK_TEST_SRC = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.BUCK_GRAPH_JSON = graphPath;
  process.env.BUCK_TARGET = target;
  await ensureGraph();
  const stdout = await (async () => {
    try {
      return await runNixBuildWithProgress({
        workspaceRoot,
        label,
        args: [
          "--impure",
          "--no-write-lock-file",
          "--option",
          "eval-cache",
          "false",
          source.flakeRef,
          "--accept-flake-config",
          "--no-link",
          "--print-out-paths",
          "-L",
        ],
      });
    } finally {
      await source.cleanup?.();
    }
  })();
  return lastOutPath(stdout, `graph-generator-selected produced no out path for ${target}`);
}
