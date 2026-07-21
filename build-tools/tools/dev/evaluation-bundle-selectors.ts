import * as fsp from "node:fs/promises";
import { allDevOverrideEnvNames } from "../lib/dev-override-envs";
import type { CopyFileCloneMode } from "../lib/copy-tree";
import type { BundleFile } from "./evaluation-bundle-manifest";
import {
  captureLanguageOverrides,
  normalizedDevOverrideValues,
  type DevOverrideValues,
  type OverrideMap,
} from "./evaluation-bundle-dev-overrides";

export {
  canonicalDevOverrideArg,
  encodeEvaluationBundleDevOverrides,
  evaluationBundleDevOverrides,
  evaluationBundleHasLanguageOverrides,
  withoutCanonicalDevOverrideArgs,
  type DevOverrideValues,
} from "./evaluation-bundle-dev-overrides";

export type VerifySeedSelection = {
  excludeCppReqs: boolean;
  partialCloneGoOnly: boolean;
  rsyncRoots: string[];
};

export function evaluationBundleWasmBackend(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): string {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--wasm-backend") values.push(String(argv[++index] || "").trim());
    else if (token.startsWith("--wasm-backend=")) values.push(token.slice(15).trim());
  }
  const envValue = String(env.WEB_WASM_BACKEND || "").trim();
  const declared = [...values, ...(envValue ? [envValue] : [])];
  if (new Set(declared).size > 1 || values.length > 1) {
    throw new Error("conflicting wasm backend selectors");
  }
  if (declared.some((value) => value !== "wasi_single")) {
    throw new Error("invalid wasm backend: expected wasi_single");
  }
  return declared[0] || "";
}

export function withoutWasmBackendArgs(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--wasm-backend") index += 1;
    else if (!token.startsWith("--wasm-backend=")) out.push(token);
  }
  return out;
}

function enabledBooleanSelector(envName: string, raw: string | undefined): boolean {
  const value = String(raw || "").trim();
  if (value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error(`invalid ${envName} for evaluation bundle: expected 0 or 1`);
}

function captureVerifySeedSelection(env: NodeJS.ProcessEnv): VerifySeedSelection {
  const roots = String(env.TEST_RSYNC_ROOTS || "")
    .trim()
    .split(/[,\s]+/u)
    .filter(Boolean)
    .map((root) => root.replace(/^\/+/, "").replace(/\/+$/, ""));
  for (const root of roots) {
    if (
      !root ||
      root.includes("\\") ||
      root.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error(`invalid TEST_RSYNC_ROOTS for evaluation bundle: ${root || "<empty>"}`);
    }
  }
  return {
    excludeCppReqs: enabledBooleanSelector("TEST_EXCLUDE_CPP_REQS", env.TEST_EXCLUDE_CPP_REQS),
    partialCloneGoOnly: enabledBooleanSelector(
      "TEST_PARTIAL_CLONE_GO_ONLY",
      env.TEST_PARTIAL_CLONE_GO_ONLY,
    ),
    rsyncRoots: [...new Set(roots)].sort(),
  };
}

export async function captureEvaluationBundleSelectors(opts: {
  bundleRoot: string;
  env: NodeJS.ProcessEnv;
  devOverrides?: DevOverrideValues;
  copyMode: CopyFileCloneMode;
  wasmBackend?: string;
  onlyCpp?: boolean;
  coverage?: boolean;
}): Promise<{
  languageOverrides: Record<string, OverrideMap>;
  onlyCpp: boolean;
  overrideFiles: BundleFile[];
  verifySeed: VerifySeedSelection;
  wasmBackend: string;
  coverage: boolean;
}> {
  if (String(opts.env.WEB_WASM_BACKEND || "").trim()) {
    throw new Error("WEB_WASM_BACKEND must be converted to --wasm-backend at ingress");
  }
  if (String(opts.env.PLANNER_ONLY_CPP || "").trim()) {
    throw new Error("PLANNER_ONLY_CPP must be converted to --planner-only-cpp at ingress");
  }
  if (String(opts.env.COVERAGE || "").trim()) {
    throw new Error("COVERAGE must be converted to --coverage at ingress");
  }
  const wasmBackend = evaluationBundleWasmBackend(
    opts.wasmBackend ? [`--wasm-backend=${opts.wasmBackend}`] : [],
  );
  const bundleRoot = await fsp.realpath(opts.bundleRoot);
  if (allDevOverrideEnvNames().some((envName) => String(opts.env[envName] || "").trim())) {
    throw new Error("dev override environment must be converted to canonical argv at ingress");
  }
  const { languageOverrides, overrideFiles } = await captureLanguageOverrides({
    bundleRoot,
    devOverrides: normalizedDevOverrideValues(opts.devOverrides || {}),
    copyMode: opts.copyMode,
  });
  return {
    languageOverrides,
    onlyCpp: Boolean(opts.onlyCpp),
    overrideFiles: overrideFiles.sort((left, right) => left.path.localeCompare(right.path)),
    verifySeed: captureVerifySeedSelection(opts.env),
    wasmBackend,
    coverage: Boolean(opts.coverage),
  };
}
