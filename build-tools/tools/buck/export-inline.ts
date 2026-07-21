#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { artifactGraphQueryRoots } from "./artifact-graph-query-roots";
import { normalizeTargetLabel } from "../lib/labels";
import { resolveWorkspaceRootSync } from "../lib/repo";
import { normalizeNixpkgPins, normalizeNixpkgsProfile } from "./source-selection";
import { DEPLOYMENT_CQUERY_ATTRS } from "../deployments/deployment-query-attrs";
import { canonicalWorkspaceGraphOutput } from "./exporter/cquery/nodes";

type InlineExportOptions = {
  workspaceRoot: string;
  outPath: string;
  target?: string;
  roots?: string[];
  includeTargetPlatforms?: boolean;
  normalizeLabels?: boolean;
  env?: NodeJS.ProcessEnv;
  buck2Bin?: string;
};

function buildAttrs(): string[] {
  return Array.from(
    new Set([
      "name",
      "rule_type",
      "buck.type",
      "module",
      "build_py_deps",
      "srcs",
      "buck.srcs",
      "nix_srcs",
      "deps",
      "link_deps",
      "header_deps",
      "link_closure",
      "link_closure_overrides",
      "link_mode",
      "nixpkgs_profile",
      "nixpkg_pins",
      "buck.link_mode",
      "buck.link_kind",
      "buck.deps",
      "labels",
      "buck.labels",
      "args",
      "env",
      "cmd",
      "out",
      "main",
      "main_class",
      "includes",
      "defines",
      "cflags",
      "ldflags",
      ...DEPLOYMENT_CQUERY_ATTRS,
    ]),
  );
}

function buildIsolationArgs(env: NodeJS.ProcessEnv = process.env): {
  isoArgs: string[];
  useIso: boolean;
  iso: string;
} {
  const parentIso = (env.BUCK_ISOLATION_DIR_EXPORTER || env.BUCK_ISOLATION_DIR || "")?.trim() || "";
  const iso = parentIso ? `${parentIso}__exporter-${process.pid}` : `exporter-${process.pid}`;
  const useIso = env.BUCK_NO_ISOLATION !== "1";
  const isoArgs = useIso ? ["--isolation-dir", iso] : [];
  return { isoArgs, useIso, iso };
}

function buildQuery(opts: { target?: string; roots: string[] }): string {
  const want = (opts.target || "").trim();
  if (want) {
    return `kind(".*", deps(${want}, 1, exec_deps()))`;
  }
  const rootsExpr = `set(${opts.roots
    .map((r) => (r.startsWith("//") ? `${r}/...` : `//${r}/...`))
    .join(" ")})`;
  return `deps(${rootsExpr}, 1, exec_deps())`;
}

export function buildInlinePlan(options: InlineExportOptions) {
  const attrs = buildAttrs();
  const flags = attrs.flatMap((a) => ["--output-attribute", a]);
  const { isoArgs, useIso, iso } = buildIsolationArgs(options.env);
  const platformFlags = options.includeTargetPlatforms
    ? ["--target-platforms", "prelude//platforms:default"]
    : [];
  const query = buildQuery({
    target: options.target,
    roots: options.roots && options.roots.length > 0 ? options.roots : ["libs"],
  });
  return {
    flags,
    isoArgs,
    platformFlags,
    useIso,
    iso,
    query,
  };
}

export async function exportInlineGraph(opts: InlineExportOptions): Promise<void> {
  const plan = buildInlinePlan(opts);
  const buck2Bin = opts.buck2Bin || "buck2";
  const env = opts.env || process.env;
  await fsp.mkdir(path.dirname(opts.outPath), { recursive: true }).catch(() => {});
  const res = await $({
    cwd: opts.workspaceRoot,
    stdio: "pipe",
    env,
  })`${buck2Bin} ${plan.isoArgs} cquery ${plan.platformFlags} ${plan.query} --json ${plan.flags}`.nothrow();
  const stdout = String(res.stdout || "");
  const parsed: Record<string, any> = (() => {
    try {
      return JSON.parse(stdout || "{}");
    } catch {
      return {};
    }
  })();
  const merged: any[] = [];
  for (const [label, raw] of Object.entries(parsed)) {
    const a = (raw || {}) as Record<string, any>;
    const ruleType: string | undefined =
      typeof a["rule_type"] === "string" ? (a["rule_type"] as string) : (a["buck.type"] as any);
    const deps: string[] | undefined = Array.isArray(a["deps"])
      ? (a["deps"] as string[])
      : Array.isArray(a["buck.deps"])
        ? (a["buck.deps"] as string[])
        : undefined;
    const labelsArr: string[] | undefined = Array.isArray(a["labels"])
      ? (a["labels"] as string[])
      : Array.isArray(a["buck.labels"])
        ? (a["buck.labels"] as string[])
        : undefined;
    const srcsArr: string[] | undefined = Array.isArray(a["srcs"])
      ? (a["srcs"] as string[])
      : Array.isArray(a["buck.srcs"])
        ? (a["buck.srcs"] as string[])
        : undefined;
    const nameRaw = String(label || a["name"] || "");
    const name = opts.normalizeLabels ? normalizeTargetLabel(nameRaw) : nameRaw;
    merged.push({
      ...a,
      name,
      out: canonicalWorkspaceGraphOutput(nameRaw, a["out"]),
      rule_type: ruleType || a["rule_type"] || "",
      deps: deps || a["deps"] || [],
      labels: Array.from(new Set(labelsArr || [])),
      srcs: srcsArr || a["srcs"] || [],
      nixpkgs_profile: normalizeNixpkgsProfile(a["nixpkgs_profile"] ?? a["buck.nixpkgs_profile"]),
      nixpkg_pins: normalizeNixpkgPins(a["nixpkg_pins"] ?? a["buck.nixpkg_pins"]),
    });
  }
  const data = (merged.length > 0 ? JSON.stringify({ nodes: merged }, null, 2) : "[]") + "\n";
  const dir = path.dirname(opts.outPath);
  const tmp = path.join(dir, `.graph.json.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, data, "utf8");
  await fsp.rename(tmp, opts.outPath);
  if (plan.useIso) {
    // lint: allow-hardcoded-buck-isolation: inline export owns and kills its selected isolation
    await $({ stdio: "pipe", env })`${buck2Bin} --isolation-dir ${plan.iso} kill`.nothrow();
  }
}

export async function runFromCLI(): Promise<void> {
  const workspaceRoot = resolveWorkspaceRootSync();
  const outPath = getFlagStr("out", path.join(workspaceRoot, DEFAULT_GRAPH_PATH));
  const targetRaw = getFlagStr("target", "");
  const target = targetRaw ? normalizeTargetLabel(targetRaw) : "";
  const rootsList = getFlagList("roots");
  const defaultRoots = artifactGraphQueryRoots();
  const envRoots = String(process.env.BUCK_QUERY_ROOTS || "").trim();
  const roots = rootsList.length
    ? rootsList
    : (envRoots ? envRoots : defaultRoots.join(",")).split(/[,\s]+/).filter(Boolean);
  const includeTargetPlatforms = getFlagBool("platforms") || !!target;
  const normalizeLabels = getFlagBool("normalize") || !!target;
  const fs = await import("node:fs");
  const existingRoots = roots.filter((r) => {
    const dir = r.replace(/^\/+/, "");
    try {
      return fs.existsSync(path.join(workspaceRoot, dir));
    } catch {
      return false;
    }
  });
  const effectiveRoots = existingRoots.length > 0 ? existingRoots : ["libs"];
  await exportInlineGraph({
    workspaceRoot,
    outPath,
    target,
    roots: effectiveRoots,
    includeTargetPlatforms,
    normalizeLabels,
  });
}

if (process.argv[1] && process.argv[1].endsWith("export-inline.ts")) {
  runFromCLI().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
