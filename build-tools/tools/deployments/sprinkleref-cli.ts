#!/usr/bin/env zx-wrapper
import { readFlagBoolFromTokens, readFlagFromTokens, readFlagStrFromTokens } from "../lib/argv";
import { assertBackendNeutralSecretRef, resolveSprinkleRefBackend } from "./sprinkleref-config";
import { readSelectedSprinkleRefConfig } from "./sprinkleref-config-select";
import { editResolverEntry, resolverBackendFromArgs } from "./sprinkleref-config-edit";
import { assertBootstrapCategoryCanWrite } from "./sprinkleref-bootstrap-guard";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { runSprinkleRefCheck } from "./sprinkleref-check";
import { collectCheckRefs } from "./sprinkleref-check-refs";
import { backendForEntry } from "./sprinkleref-check-classify";
import { initSprinkleRefConfigs } from "./sprinkleref-templates";
import { renderSprinkleRefFingerprint } from "./sprinkleref-fingerprint";
import { confirmRemoval, readSecretValue } from "./sprinkleref-secret-input";
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

export function sprinklerefUsage() {
  return `Usage:
  sprinkleref --init <dir>
  sprinkleref --resolver-entry --add <category> --backend <kind> [backend options]
  sprinkleref --resolver-entry --update <category> --backend <kind> [backend options]
  sprinkleref --check [--scheme secret|config|runtime] [--format json]
  sprinkleref --get <secret://...> --fingerprint [--category <name>] [--format json]
  sprinkleref --add <secret://...> [--category <name>] [--value-env <name>|--value-file <path>]
  sprinkleref --update <secret://...> [--category <name>] [--value-env <name>|--value-file <path>]
  sprinkleref --remove <secret://...> [--category <name>] [--yes]

Options:
  --config <path>              Resolver config path
  --category <name>            Resolver category, defaults from config
  --overwrite-existing         Allow --add to replace an existing ref or resolver category
  --create-missing             Allow --update to create a missing ref or resolver category
  --check                      Inventory and validate deployment contract refs
  --fingerprint                Print only a digest for --get; secret values are never printed
  --target <buck-target>       Limit --check to structured refs required by a Buck target
  --dry-run                    Describe the selected backend without reading or writing values
`;
}

export async function runSprinkleRefCli(deps: SprinkleRefCliDeps) {
  validateKnownFlags(deps.argv, readFlagBoolFromTokens("check", deps.argv));
  const out = deps.stdout || console.log;
  if (readFlagBoolFromTokens("help", deps.argv)) return out(sprinklerefUsage());
  if (readFlagBoolFromTokens("check", deps.argv) || readFlagBoolFromTokens("all", deps.argv)) {
    const exitCode = await runSprinkleRefCheck(deps);
    process.exitCode = exitCode;
    return;
  }
  const initFlag = readFlagFromTokens("init", deps.argv);
  if (initFlag.provided) {
    const initDir = initFlag.value.trim() || "sprinkleref";
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
