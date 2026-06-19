#!/usr/bin/env zx-wrapper
import * as path from "node:path";
import { readFlagBoolFromTokens, readFlagFromTokens, readFlagStrFromTokens } from "../lib/argv";
import { assertBackendNeutralSecretRef, resolveSprinkleRefBackend } from "./sprinkleref-config";
import {
  DEFAULT_SPRINKLEREF_CONFIG_PATH,
  readSelectedSprinkleRefConfig,
} from "./sprinkleref-config-select";
import { editResolverEntry, resolverBackendFromArgs } from "./sprinkleref-config-edit";
import { assertBootstrapCategoryCanWrite } from "./sprinkleref-bootstrap-guard";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { runSprinkleRefCheck } from "./sprinkleref-check";
import { collectCheckRefs } from "./sprinkleref-check-refs";
import { backendForEntry } from "./sprinkleref-check-classify";
import { initLocalSprinkleRefValues, initSprinkleRefConfigs } from "./sprinkleref-templates";
import { renderSprinkleRefFingerprint } from "./sprinkleref-fingerprint";
import { confirmRemoval, readSecretValue } from "./sprinkleref-secret-input";
import { sprinklerefUsage } from "./sprinkleref-usage";
import type { SprinkleRefBackendConfig, SprinkleRefOperation } from "./sprinkleref-types";

const VALUE_FLAGS = [
  "add",
  "get",
  "update",
  "remove",
  "algorithm",
  "category",
  "config",
  "value-env",
  "value-file",
  "init",
  "backend",
  "file",
  "service",
  "host",
  "project-id",
  "project-ref",
  "default-environment",
  "default-path",
  "client-id-env",
  "client-secret-env",
  "token-env",
  "scope",
  "name-prefix",
  "scheme",
  "format",
  "target",
  "deps",
];
const BOOL_FLAGS = [
  "yes",
  "dry-run",
  "fingerprint",
  "help",
  "resolver-entry",
  "overwrite-existing",
  "create-missing",
  "check",
  "all",
  "no-deps",
  "init-local",
];

export type SprinkleRefCliDeps = {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  prompt?: (label: string) => Promise<string>;
  confirm?: (label: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  stdout?: (text: string) => void;
};

export async function runSprinkleRefCli(deps: SprinkleRefCliDeps) {
  validateKnownFlags(deps.argv, readFlagBoolFromTokens("check", deps.argv));
  const out = deps.stdout || console.log;
  const positional = positionalCommand(deps.argv);
  if (positional.command === "help") return out(sprinklerefUsage());
  if (positional.command === "check") {
    const exitCode = await runSprinkleRefCheck({ ...deps, argv: positional.argv });
    process.exitCode = exitCode;
    return;
  }
  if (positional.command === "list") {
    await runSprinkleRefCheck({ ...deps, argv: positional.argv });
    return;
  }
  if (positional.command) throw new Error(`unknown command: ${positional.command}`);
  if (readFlagBoolFromTokens("help", deps.argv)) return out(sprinklerefUsage());
  if (readFlagBoolFromTokens("init-local", deps.argv)) {
    const written = await initLocalSprinkleRefValues(process.cwd());
    return out(
      JSON.stringify(
        {
          written,
          nextCommand:
            "sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing",
        },
        null,
        2,
      ),
    );
  }
  if (readFlagBoolFromTokens("check", deps.argv) || readFlagBoolFromTokens("all", deps.argv)) {
    const exitCode = await runSprinkleRefCheck(deps);
    process.exitCode = exitCode;
    return;
  }
  const initFlag = readFlagFromTokens("init", deps.argv);
  if (initFlag.provided) {
    const initDir = initFlag.value.trim() || path.dirname(DEFAULT_SPRINKLEREF_CONFIG_PATH);
    const written = await initSprinkleRefConfigs({ dir: initDir, platform: deps.platform });
    return out(JSON.stringify({ written }, null, 2));
  }
  const action = actionFromArgs(deps.argv);
  if (readFlagBoolFromTokens("resolver-entry", deps.argv)) {
    if (action.operation === "get") throw new Error("--resolver-entry supports --add or --update");
    return await runResolverEntryEdit(deps, action, out);
  }
  assertBackendNeutralSecretRef(action.ref);
  const config = await readSelectedSprinkleRefConfig(
    readFlagStrFromTokens("config", "", deps.argv),
    deps.env,
  );
  const category = readFlagStrFromTokens("category", "", deps.argv);
  const resolved = resolveSprinkleRefBackend(config, category);
  assertBootstrapCategoryCanWrite(resolved);
  const backend = await backendForAction(deps, action.ref, resolved.backend);
  const store = createSprinkleRefStore(backend, {
    env: deps.env,
    platform: deps.platform,
    fetchImpl: deps.fetchImpl,
    resolverConfig: config,
  });
  if (readFlagBoolFromTokens("dry-run", deps.argv))
    return out(
      JSON.stringify(
        {
          operation: action.operation,
          ref: action.ref,
          category: resolved.category,
          backend: store.describe(),
        },
        null,
        2,
      ),
    );
  if (action.operation === "get") {
    if (!readFlagBoolFromTokens("fingerprint", deps.argv)) {
      throw new Error("sprinkleref --get requires --fingerprint; secret values are never printed");
    }
    return out(
      await renderSprinkleRefFingerprint({
        argv: deps.argv,
        ref: action.ref,
        category: resolved.category,
        store,
      }),
    );
  }
  if (action.operation === "remove") {
    if (!readFlagBoolFromTokens("yes", deps.argv) && !(await confirmRemoval(deps, action.ref))) {
      throw new Error(`remove ${action.ref} requires confirmation or --yes`);
    }
    await store.remove(action.ref);
    return out(`removed ${action.ref} from ${resolved.category}`);
  }
  const value = await readSecretValue(deps);
  if (action.operation === "add") {
    if (readFlagBoolFromTokens("overwrite-existing", deps.argv) && (await store.has(action.ref))) {
      await store.update(action.ref, value);
    } else await store.add(action.ref, value);
  } else if (
    readFlagBoolFromTokens("create-missing", deps.argv) &&
    !(await store.has(action.ref))
  ) {
    await store.add(action.ref, value);
  } else await store.update(action.ref, value);
  out(`${action.operation === "add" ? "added" : "updated"} ${action.ref} in ${resolved.category}`);
}

async function backendForAction(
  deps: SprinkleRefCliDeps,
  ref: string,
  backend: SprinkleRefBackendConfig,
): Promise<SprinkleRefBackendConfig> {
  const target = readFlagStrFromTokens("target", "", deps.argv).trim();
  if (!target) return backend;
  const refs = await collectCheckRefs({
    target,
    deps: "transitive",
    env: deps.env,
    usageError: (message) => {
      throw Object.assign(new Error(message), { exitCode: 3 });
    },
  });
  const entry = refs.refs.find((candidate) => candidate.ref === ref);
  if (!entry) throw new Error(`${ref} is not required by ${target}`);
  return backendForEntry(backend, entry);
}

async function runResolverEntryEdit(
  deps: SprinkleRefCliDeps,
  action: CliAction,
  out: (text: string) => void,
) {
  if (action.operation === "get") throw new Error("--resolver-entry supports --add or --update");
  if (action.operation === "remove") throw new Error("--resolver-entry supports --add or --update");
  rejectResolverEntrySecretInputs(deps.argv);
  const configPath = readFlagStrFromTokens("config", "", deps.argv).trim();
  if (!configPath) throw new Error("--resolver-entry requires --config");
  await editResolverEntry({
    configPath,
    category: action.ref,
    backend: resolverBackendFromArgs(deps.argv),
    mode: action.operation,
    overwriteExisting: readFlagBoolFromTokens("overwrite-existing", deps.argv),
    createMissing: readFlagBoolFromTokens("create-missing", deps.argv),
  });
  out(`${action.operation === "add" ? "added" : "updated"} resolver category ${action.ref}`);
}

function rejectResolverEntrySecretInputs(argv: string[]) {
  if (
    readFlagStrFromTokens("value-env", "", argv) ||
    readFlagStrFromTokens("value-file", "", argv)
  ) {
    throw new Error(
      "--resolver-entry edits backend selection only; secret values are not accepted",
    );
  }
}

type CliAction = { operation: SprinkleRefOperation | "get"; ref: string };

function actionFromArgs(argv: string[]): CliAction {
  const actions = ["add", "get", "update", "remove"] as const;
  const found = actions.flatMap((name) => {
    const value = readFlagStrFromTokens(name, "", argv).trim();
    return value ? [{ operation: name, ref: value }] : [];
  });
  if (found.length !== 1) throw new Error("use exactly one of --add, --get, --update, or --remove");
  return found[0];
}

function validateKnownFlags(argv: string[], usageExit = false) {
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).split("=")[0];
    if (!VALUE_FLAGS.includes(name) && !BOOL_FLAGS.includes(name)) {
      const error = new Error(`unknown argument: --${name}`);
      if (usageExit) throw Object.assign(error, { exitCode: 3 });
      throw error;
    }
  }
}

function positionalCommand(argv: string[]): { command: string; argv: string[] } {
  const positionals: Array<{ value: string; index: number }> = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] || "";
    if (token.startsWith("--")) {
      if (token.includes("=")) continue;
      const name = token.slice(2);
      if (VALUE_FLAGS.includes(name)) {
        const value = argv[i + 1] || "";
        if (value && !value.startsWith("--")) i++;
      }
      continue;
    }
    positionals.push({ value: token, index: i });
  }
  if (positionals.length === 0) return { command: "", argv };
  if (positionals.length > 1) {
    throw new Error(
      `unexpected positional arguments: ${positionals.map((p) => p.value).join(" ")}`,
    );
  }
  const command = positionals[0];
  return {
    command: command?.value || "",
    argv: argv.filter((_, index) => index !== command?.index),
  };
}
