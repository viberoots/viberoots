#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { readFlagBoolFromTokens, readFlagStrFromTokens } from "../lib/argv";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import {
  assertBackendNeutralSecretRef,
  readSprinkleRefConfig,
  resolveSprinkleRefBackend,
} from "./sprinkleref-config";
import { assertBootstrapCategoryCanWrite } from "./sprinkleref-bootstrap-guard";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { collectCheckRefs } from "./sprinkleref-check-refs";
import { exitCodeFor, renderReport, summarize } from "./sprinkleref-check-report";
import {
  backendForEntry,
  consolidateRefs,
  managedBootstrapOutput,
  type CheckableRef,
} from "./sprinkleref-check-classify";
import type {
  SprinkleRefCheckEntry,
  SprinkleRefCheckReport,
  SprinkleRefDepsMode,
} from "./sprinkleref-check-types";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";

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
  const refs = await collectCheckRefs({
    target: options.target,
    deps: options.deps,
    env: deps.env,
    usageError,
  });
  const filtered = refs.refs.filter((entry) => options.schemes.has(entry.scheme));
  const entries = await checkRefs(consolidateRefs(filtered), deps, options);
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

async function checkRefs(
  refs: CheckableRef[],
  deps: SprinkleRefCheckDeps,
  options: ReturnType<typeof parseCheckOptions>,
): Promise<SprinkleRefCheckEntry[]> {
  const config = await maybeReadConfig(options.configPath, deps.env);
  return await Promise.all(
    refs.map(async (entry) => {
      if (!validRef(entry.ref)) return base(entry, "invalid", "malformed deployment contract ref");
      if (entry.scheme !== "secret") return base(entry, "declared");
      const managed = managedBootstrapOutput(entry.ref);
      if (options.category === "bootstrap" && !managed) {
        return base(entry, "declared", "not a bootstrap-managed secret");
      }
      if (managed && options.category !== "bootstrap") {
        return {
          ...base(entry, "managed", managed.reason),
          managedBy: managed.by,
          managedFamily: managed.family,
        };
      }
      if (!config) return base(entry, "unchecked", "no resolver config supplied");
      try {
        assertBackendNeutralSecretRef(entry.ref);
        const resolved = resolveSprinkleRefBackend(config, options.category);
        assertBootstrapCategoryCanWrite(resolved);
        const backend = backendForEntry(resolved.backend, entry);
        const store = createStore(deps, backend, config);
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
  const selected =
    configPath || env.SPRINKLEREF_CONFIG || (await existingDefaultConfigPath()) || "";
  if (!selected) return undefined;
  try {
    return await readSprinkleRefConfig(selected);
  } catch (error) {
    backendError(configReadErrorMessage(selected, error));
  }
}

async function existingDefaultConfigPath() {
  for (const configPath of [
    DEFAULT_SPRINKLEREF_CONFIG_PATH,
    "config/sprinkleref/selected.local.json",
  ]) {
    if ((await fs.stat(configPath).catch(() => undefined))?.isFile()) return configPath;
  }
  return "";
}

function configReadErrorMessage(selected: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    (error && typeof error === "object" && "code" in error && error.code === "ENOENT") ||
    /ENOENT/.test(message)
  ) {
    return `SprinkleRef resolver config not found: ${selected}. Run build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run, then build-tools/tools/deployments/infisical-bootstrap.ts repo (or add --yes to skip the prompt), or run sprinkleref --init config/sprinkleref and edit the generated config for this environment. Then retry with --config ${selected}.`;
  }
  return message;
}

function createStore(
  deps: SprinkleRefCheckDeps,
  backend: Parameters<typeof createSprinkleRefStore>[0],
  resolverConfig: Awaited<ReturnType<typeof readSprinkleRefConfig>>,
) {
  try {
    return (deps.storeFactory || createSprinkleRefStore)(backend, { ...deps, resolverConfig });
  } catch (error) {
    backendError(error instanceof Error ? error.message : String(error));
  }
}

function base(
  entry: Pick<
    SprinkleRefCheckEntry,
    | "ref"
    | "scheme"
    | "scope"
    | "locations"
    | "requiredBy"
    | "source"
    | "backendEnvironment"
    | "backendHost"
    | "backendProjectId"
    | "backendProjectName"
    | "backendSecretPath"
    | "deploymentFamily"
  >,
  status: SprinkleRefCheckEntry["status"],
  reason?: string,
): SprinkleRefCheckEntry {
  return { ...entry, status, reason, sensitive: entry.scheme === "secret" };
}

function validRef(ref: string): boolean {
  return /^(secret|config|runtime):\/\/[A-Za-z0-9][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*$/.test(ref);
}

function usageError(message: string): never {
  throw Object.assign(new Error(message), { exitCode: 3 });
}

function backendError(message: string): never {
  throw Object.assign(new Error(redactDeploymentAuthText(message)), { exitCode: 2 });
}
