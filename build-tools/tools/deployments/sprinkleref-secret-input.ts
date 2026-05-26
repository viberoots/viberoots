#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { readFlagStrFromTokens } from "../lib/argv";

export type SprinkleRefSecretInputDeps = {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  prompt?: (label: string) => Promise<string>;
  confirm?: (label: string) => Promise<boolean>;
};

export async function readSecretValue(deps: SprinkleRefSecretInputDeps) {
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
  if (!input.isTTY) {
    throw new Error("missing secret value; pass --value-env, --value-file, or use a TTY");
  }
  return await hiddenPrompt("Secret value: ");
}

export async function confirmRemoval(deps: SprinkleRefSecretInputDeps, ref: string) {
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
