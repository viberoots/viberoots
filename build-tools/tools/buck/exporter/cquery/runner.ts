#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";

export type CqueryRunnerOptions = {
  scope: string; // label selector used by attrfilter(labels, <scope>, <expr>)
  attrs: string[]; // list of requested --output-attribute values
};

function parseCsvish(v: string): string[] {
  return String(v || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function platformFromBuckconfig(cwd: string): string {
  try {
    const cfgPath = path.join(cwd, ".buckconfig");
    if (!fs.existsSync(cfgPath)) return "";
    const txt = String(fs.readFileSync(cfgPath, "utf8") || "");
    const m =
      txt.match(/^\s*target_platforms\s*=\s*(\S+)\s*$/m) ||
      txt.match(/^\s*default_platform\s*=\s*(\S+)\s*$/m);
    return m && m[1] ? String(m[1]).trim() : "";
  } catch {
    return "";
  }
}

function computePlatformLabel(cwd: string): string {
  const env = String(
    process.env.BUCK_TARGET_PLATFORMS || process.env.BUCK_TARGET_PLATFORM || "",
  ).trim();
  return env || platformFromBuckconfig(cwd) || "prelude//platforms:default";
}

function computeRootsExpr(cwd: string): string {
  const defaultRoots = ["apps", "libs", "third_party", "go", "cpp"];
  const rootsFromEnv = parseCsvish(process.env.BUCK_QUERY_ROOTS || "");
  const rootsList = rootsFromEnv.length > 0 ? rootsFromEnv : defaultRoots;
  const existing = rootsList.filter((r) => {
    const dir = r.replace(/^\/+/, "");
    try {
      return fs.existsSync(path.join(cwd, dir));
    } catch {
      return false;
    }
  });
  // If none of the conventional roots exist in this workspace (common in temp-repo tests),
  // fall back to scanning the whole repo with //... rather than referencing a non-existent dir.
  if (existing.length === 0) return "//...";
  const roots = existing;
  const patterns = roots.map((r) => {
    const root = r.startsWith("//") ? r : `//${r}`;
    return `${root}/...`;
  });
  return `set(${patterns.join(" ")})`;
}

function computeIsolationFlags(): { iso: string; flags: string[] } {
  if (process.env.BUCK_NO_ISOLATION === "1") return { iso: "", flags: [] };
  const parentIso = String(
    process.env.BUCK_ISOLATION_DIR_EXPORTER || process.env.BUCK_ISOLATION_DIR || "",
  ).trim();
  const iso = parentIso ? `${parentIso}__exporter-${process.pid}` : `exporter-${process.pid}`;
  return { iso, flags: ["--isolation-dir", iso] };
}

async function withBuckCleanup<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  if (!iso) return await fn();
  const onSignal = async () => {
    try {
      const cwd = String(
        process.env.BUCK_TEST_SRC || process.env.WORKSPACE_ROOT || process.cwd(),
      ).trim();
      await $({
        cwd,
        env: {
          ...process.env,
          HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
          SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
        },
      })`buck2 --isolation-dir ${iso} kill`;
    } catch {}
    process.exit(130);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    try {
      (process as any).on(sig, onSignal);
    } catch {}
  }
  try {
    return await fn();
  } finally {
    try {
      const cwd = String(
        process.env.BUCK_TEST_SRC || process.env.WORKSPACE_ROOT || process.cwd(),
      ).trim();
      await $({
        cwd,
        env: {
          ...process.env,
          HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
          SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
        },
      })`buck2 --isolation-dir ${iso} kill`;
    } catch {}
  }
}

export async function runCqueryMerged(opts: CqueryRunnerOptions): Promise<Record<string, any>> {
  const cwd = String(
    process.env.BUCK_TEST_SRC || process.env.WORKSPACE_ROOT || process.cwd(),
  ).trim();
  const flags = (opts.attrs || []).flatMap((a) => ["--output-attribute", a]);
  const platformLabel = computePlatformLabel(cwd);
  const platformFlags = ["--target-platforms", platformLabel];
  const rootsExpr = computeRootsExpr(cwd);
  const { iso, flags: isolationFlags } = computeIsolationFlags();

  const runQuery = async (q: string): Promise<Record<string, any>> => {
    const qScoped = q.replaceAll("//...", rootsExpr);
    const query = opts.scope ? `attrfilter(labels, ${opts.scope}, ${qScoped})` : qScoped;
    if (String(process.env.EXPORTER_DEBUG || "").trim() === "1") {
      console.warn(`[exporter][debug] buck2 cquery ${platformFlags.join(" ")} ${query}`);
    }
    const buckEnv = {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    };
    const { stdout } = await $({
      cwd,
      stdio: "pipe",
      env: buckEnv,
    })`buck2 ${isolationFlags} cquery ${platformFlags} ${query} --json ${flags}`.quiet();
    return JSON.parse(String(stdout)) as Record<string, any>;
  };

  const runQueryWithRetry = async (q: string): Promise<Record<string, any>> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await runQuery(q);
      } catch (e) {
        lastErr = e;
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`buck2 cquery failed after retry for query: ${q}\n${msg}`);
  };

  return await withBuckCleanup(iso, async () => {
    const runQueriesOnce = async (): Promise<Record<string, any>> => {
      const base = `deps(//..., 1, exec_deps())`;
      const allKind = `kind(".*", //...)`;
      const kindCxxTest = `kind("cxx_test", //...)`;
      const attrCxxTest = `attrfilter(rule_type, "cxx_test", //...)`;
      const kindCxxBin = `kind("cxx_binary", //...)`;
      const attrCxxBin = `attrfilter(rule_type, "cxx_binary", //...)`;
      const cxxPlanner = `filter("__planner$", kind("cxx_library", //...))`;
      const labeledCpp = `attrfilter(labels, "lang:cpp", //...)`;
      const kindNixCxxLib = `attrfilter(rule_type, "nix_cxx_library", //...)`;
      const [obj0, obj1, obj2, obj3, obj4, obj5, obj6, obj7, obj8] = await Promise.all([
        runQueryWithRetry(allKind),
        runQueryWithRetry(base),
        runQueryWithRetry(kindCxxTest),
        runQueryWithRetry(attrCxxTest),
        runQueryWithRetry(kindCxxBin),
        runQueryWithRetry(attrCxxBin),
        runQueryWithRetry(cxxPlanner),
        runQueryWithRetry(labeledCpp),
        runQueryWithRetry(kindNixCxxLib),
      ]);
      return {
        ...obj0,
        ...obj1,
        ...obj2,
        ...obj3,
        ...obj4,
        ...obj5,
        ...obj6,
        ...obj7,
        ...obj8,
      };
    };

    let merged = await runQueriesOnce();
    if (Object.keys(merged).length === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      merged = await runQueriesOnce();
    }
    return merged;
  });
}
