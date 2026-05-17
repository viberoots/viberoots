#!/usr/bin/env zx-wrapper
import { readFlagBoolFromTokens, readFlagStrFromTokens } from "../lib/argv";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import {
  assertBackendNeutralSecretRef,
  readSprinkleRefConfig,
  resolveSprinkleRefBackend,
} from "./sprinkleref-config";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { scanRepositoryRefs, type ScannedRef } from "./sprinkleref-check-scan";
import { collectTargetRefs, type TargetRef } from "./sprinkleref-check-target";
import { exitCodeFor, renderReport, summarize } from "./sprinkleref-check-report";
import type {
  SprinkleRefCheckEntry,
  SprinkleRefCheckReport,
  SprinkleRefDepsMode,
  SprinkleRefScheme,
} from "./sprinkleref-check-types";

export type SprinkleRefCheckDeps = {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
  storeFactory?: typeof createSprinkleRefStore;
  stdout?: (text: string) => void;
};

export async function runSprinkleRefCheck(deps: SprinkleRefCheckDeps): Promise<number> {
  const options = parseCheckOptions(deps.argv);
  const refs = options.target
    ? await targetRefs(options.target, options.deps, deps.env)
    : await repoRefs();
  const filtered = refs.refs.filter((entry) => options.schemes.has(entry.scheme));
  const entries = await checkRefs(filtered, deps, options);
  const report = {
    target: options.target,
    deps: options.target ? options.deps : undefined,
    scannedFiles: refs.scannedFiles,
    refs: entries,
    summary: summarize(entries),
  };
  const out = deps.stdout || console.log;
  out(options.format === "json" ? JSON.stringify(report, null, 2) : renderReport(report));
  return exitCodeFor(report);
}

function parseCheckOptions(argv: string[]) {
  const scheme = readFlagStrFromTokens("scheme", "", argv).trim();
  const schemes = new Set<SprinkleRefScheme>(
    scheme ? [parseScheme(scheme)] : ["secret", "config", "runtime"],
  );
  const deps = parseDeps(argv);
  const format = readFlagStrFromTokens("format", "human", argv).trim();
  if (format !== "human" && format !== "json") usageError("--format must be human or json");
  return {
    schemes,
    deps,
    format,
    target: readFlagStrFromTokens("target", "", argv).trim(),
    configPath: readFlagStrFromTokens("config", "", argv).trim(),
    category: readFlagStrFromTokens("category", "", argv).trim(),
  };
}

function parseScheme(value: string): SprinkleRefScheme {
  if (value === "secret" || value === "config" || value === "runtime") return value;
  return usageError("--scheme must be secret, config, or runtime");
}

function parseDeps(argv: string[]): SprinkleRefDepsMode {
  if (readFlagBoolFromTokens("no-deps", argv)) return "none";
  const value = readFlagStrFromTokens("deps", "transitive", argv).trim();
  if (value === "none" || value === "direct" || value === "transitive") return value;
  return usageError("--deps must be none, direct, or transitive");
}

async function repoRefs() {
  const scanned = await scanRepositoryRefs().catch((error: unknown) =>
    usageError(error instanceof Error ? error.message : String(error)),
  );
  return {
    scannedFiles: scanned.scannedFiles,
    refs: scanned.refs.map((entry) => ({
      ref: entry.ref,
      scheme: entry.scheme,
      scope: "repo" as const,
      locations: entry.locations.map((loc) => `${loc.file}:${loc.line}`),
      requiredBy: [],
    })),
  };
}

async function targetRefs(target: string, deps: SprinkleRefDepsMode, env?: NodeJS.ProcessEnv) {
  const refs = await collectTargetRefs({ target, deps, env }).catch((error: unknown) =>
    usageError(error instanceof Error ? error.message : String(error)),
  );
  return {
    scannedFiles: 0,
    refs: refs.map((entry) => ({
      ref: entry.ref,
      scheme: schemeOf(entry.ref),
      scope: entry.scope,
      locations: entry.locations,
      requiredBy: [entry.requiredBy],
      source: entry.source,
    })),
  };
}

async function checkRefs(
  refs: Array<
    Pick<SprinkleRefCheckEntry, "ref" | "scheme" | "scope" | "locations" | "requiredBy" | "source">
  >,
  deps: SprinkleRefCheckDeps,
  options: ReturnType<typeof parseCheckOptions>,
): Promise<SprinkleRefCheckEntry[]> {
  const config = await maybeReadConfig(options.configPath, deps.env);
  return await Promise.all(
    refs.map(async (entry) => {
      if (!validRef(entry.ref)) return base(entry, "invalid", "malformed deployment contract ref");
      if (entry.scheme !== "secret") return base(entry, "declared");
      if (!config) return base(entry, "unchecked", "no resolver config supplied");
      try {
        assertBackendNeutralSecretRef(entry.ref);
        const resolved = resolveSprinkleRefBackend(config, options.category);
        const store = createStore(deps, resolved.backend);
        const present = await store.has(entry.ref).catch((error: unknown) => {
          backendError(error instanceof Error ? error.message : String(error));
        });
        return {
          ...base(entry, present ? "present" : "missing"),
          category: resolved.category,
          backend: store.describe(),
        };
      } catch (error) {
        if (error && typeof error === "object" && "exitCode" in error) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (/backend-neutral/.test(message)) return base(entry, "invalid", message);
        return base(entry, "unmapped", message);
      }
    }),
  );
}

async function maybeReadConfig(configPath: string, env: NodeJS.ProcessEnv = process.env) {
  const selected = configPath || env.SPRINKLEREF_CONFIG || "";
  if (!selected) return undefined;
  try {
    return await readSprinkleRefConfig(selected);
  } catch (error) {
    backendError(error instanceof Error ? error.message : String(error));
  }
}

function createStore(
  deps: SprinkleRefCheckDeps,
  backend: Parameters<typeof createSprinkleRefStore>[0],
) {
  try {
    return (deps.storeFactory || createSprinkleRefStore)(backend, deps);
  } catch (error) {
    backendError(error instanceof Error ? error.message : String(error));
  }
}

function base(
  entry: Pick<
    SprinkleRefCheckEntry,
    "ref" | "scheme" | "scope" | "locations" | "requiredBy" | "source"
  >,
  status: SprinkleRefCheckEntry["status"],
  reason?: string,
): SprinkleRefCheckEntry {
  return { ...entry, status, reason, sensitive: entry.scheme === "secret" };
}

function validRef(ref: string): boolean {
  return /^(secret|config|runtime):\/\/[A-Za-z0-9][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*$/.test(ref);
}

function schemeOf(ref: string): SprinkleRefScheme {
  return ref.slice(0, ref.indexOf("://")) as SprinkleRefScheme;
}

function usageError(message: string): never {
  throw Object.assign(new Error(message), { exitCode: 3 });
}

function backendError(message: string): never {
  throw Object.assign(new Error(redactDeploymentAuthText(message)), { exitCode: 2 });
}
