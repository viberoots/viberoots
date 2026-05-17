#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFlagBoolFromTokens, readFlagFromTokens, readFlagStrFromTokens } from "../lib/argv";
import {
  assertBackendNeutralSecretRef,
  readSprinkleRefConfig,
  resolveSprinkleRefBackend,
} from "./sprinkleref-config";
import { createSprinkleRefStore } from "./sprinkleref-store";
import { initSprinkleRefConfigs } from "./sprinkleref-templates";
import type { SprinkleRefOperation } from "./sprinkleref-types";

const VALUE_FLAGS = [
  "add",
  "update",
  "remove",
  "category",
  "config",
  "value-env",
  "value-file",
  "init",
];
const BOOL_FLAGS = ["yes", "dry-run", "help"];

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
  sprinkleref --add <secret://...> [--category <name>] [--value-env <name>|--value-file <path>]
  sprinkleref --update <secret://...> [--category <name>] [--value-env <name>|--value-file <path>]
  sprinkleref --remove <secret://...> [--category <name>] [--yes]

Options:
  --config <path>              Resolver config path
  --category <name>            Resolver category, defaults from config
  --dry-run                    Describe the selected backend without reading or writing values
`;
}

export async function runSprinkleRefCli(deps: SprinkleRefCliDeps) {
  validateKnownFlags(deps.argv);
  const out = deps.stdout || console.log;
  if (readFlagBoolFromTokens("help", deps.argv)) return out(sprinklerefUsage());
  const initFlag = readFlagFromTokens("init", deps.argv);
  if (initFlag.provided) {
    const initDir = initFlag.value.trim() || "sprinkleref";
    const written = await initSprinkleRefConfigs({ dir: initDir, platform: deps.platform });
    return out(JSON.stringify({ written }, null, 2));
  }
  const action = actionFromArgs(deps.argv);
  assertBackendNeutralSecretRef(action.ref);
  const config = await readSprinkleRefConfig(readFlagStrFromTokens("config", "", deps.argv));
  const resolved = resolveSprinkleRefBackend(
    config,
    readFlagStrFromTokens("category", "", deps.argv),
  );
  const store = createSprinkleRefStore(resolved.backend, {
    env: deps.env,
    platform: deps.platform,
    fetchImpl: deps.fetchImpl,
  });
  if (readFlagBoolFromTokens("dry-run", deps.argv)) {
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
  }
  if (action.operation === "remove") {
    if (!readFlagBoolFromTokens("yes", deps.argv) && !(await confirmRemoval(deps, action.ref))) {
      throw new Error(`remove ${action.ref} requires confirmation or --yes`);
    }
    await store.remove(action.ref);
    return out(`removed ${action.ref} from ${resolved.category}`);
  }
  const value = await readSecretValue(deps);
  if (action.operation === "add") await store.add(action.ref, value);
  else await store.update(action.ref, value);
  out(`${action.operation === "add" ? "added" : "updated"} ${action.ref} in ${resolved.category}`);
}

function actionFromArgs(argv: string[]): { operation: SprinkleRefOperation; ref: string } {
  const actions = ["add", "update", "remove"] as const;
  const found = actions.flatMap((name) => {
    const value = readFlagStrFromTokens(name, "", argv).trim();
    return value ? [{ operation: name, ref: value }] : [];
  });
  if (found.length !== 1) throw new Error("use exactly one of --add, --update, or --remove");
  return found[0];
}

async function readSecretValue(deps: SprinkleRefCliDeps) {
  const envName = readFlagStrFromTokens("value-env", "", deps.argv).trim();
  const file = readFlagStrFromTokens("value-file", "", deps.argv).trim();
  if (envName && file) throw new Error("use only one of --value-env or --value-file");
  if (envName) {
    const value = String((deps.env || process.env)[envName] || "");
    if (!value) throw new Error(`missing secret value env ${envName}`);
    return value;
  }
  if (file) return await fs.readFile(file, "utf8");
  if (deps.prompt) return await deps.prompt("Secret value: ");
  if (!input.isTTY)
    throw new Error("missing secret value; pass --value-env, --value-file, or use a TTY");
  return await hiddenPrompt("Secret value: ");
}

async function confirmRemoval(deps: SprinkleRefCliDeps, ref: string) {
  if (deps.confirm) return await deps.confirm(`Remove ${ref}?`);
  if (!input.isTTY) return false;
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(`Remove ${ref}? type yes: `)).trim() === "yes";
  } finally {
    rl.close();
  }
}

async function hiddenPrompt(label: string) {
  output.write(label);
  input.setRawMode?.(true);
  input.resume();
  let value = "";
  try {
    for await (const chunk of input) {
      const text = String(chunk);
      if (text === "\r" || text === "\n" || text === "\r\n") break;
      if (text === "\u0003") throw new Error("secret prompt cancelled");
      if (text === "\u007f") value = value.slice(0, -1);
      else value += text;
    }
  } finally {
    input.setRawMode?.(false);
  }
  output.write("\n");
  return value;
}

function validateKnownFlags(argv: string[]) {
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).split("=")[0];
    if (!VALUE_FLAGS.includes(name) && !BOOL_FLAGS.includes(name))
      throw new Error(`unknown argument: --${name}`);
  }
}
