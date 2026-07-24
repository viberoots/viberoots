import { accountNameError, isValidAccountName } from "./name";
import type { ParsedAccountArgs } from "./types";
import { fail } from "./errors";

const VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "-i",
  "--image",
  "-m",
  "--model",
  "--local-provider",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "--remote",
  "--remote-auth-token-env",
  "-C",
  "--cd",
  "--add-dir",
  "-a",
  "--ask-for-approval",
  "--enable",
  "--disable",
  "-w",
  "--worktree",
  "--remove-worktree",
]);

function requiredName(flag: string, value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.startsWith("-")) {
    fail(
      `error: ${flag} requires a name (e.g. ${flag} codex-account-a); refusing to consume the next argument`,
      2,
    );
  }
  if (!isValidAccountName(value)) fail(accountNameError(value), 2);
  return value;
}

function commandFrom(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] || "";
    if (token === "--") return null;
    if (VALUE_FLAGS.has(token)) {
      if (i + 1 < args.length) i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return null;
}

export function parseAccountArgs(input: string[]): ParsedAccountArgs {
  const strippedArgs: string[] = [];
  let accountName: string | null = null;
  let accountInit = false;
  let listFormat: "text" | "json" | null = null;
  let removeName: string | null = null;
  let removeYes = false;
  let leading = true;

  for (let i = 0; i < input.length; i++) {
    const token = input[i] || "";
    if (!leading) {
      strippedArgs.push(token);
      continue;
    }
    if (token === "--") {
      leading = false;
      strippedArgs.push(token);
      continue;
    }
    if (!token.startsWith("-")) {
      leading = false;
      strippedArgs.push(token);
      continue;
    }
    if (token === "--account" || token.startsWith("--account=")) {
      if (accountName !== null) fail("error: --account specified more than once; pick one", 2);
      const inline = token.startsWith("--account=") ? token.slice("--account=".length) : undefined;
      const value = inline ?? input[++i];
      accountName = requiredName("--account", value);
      continue;
    }
    if (token === "--account-init") {
      accountInit = true;
      continue;
    }
    if (token === "--remove-account" || token.startsWith("--remove-account=")) {
      if (removeName !== null) {
        fail("error: --remove-account specified more than once; pick one", 2);
      }
      const inline = token.startsWith("--remove-account=")
        ? token.slice("--remove-account=".length)
        : undefined;
      const value = inline ?? input[++i];
      removeName = requiredName("--remove-account", value);
      continue;
    }
    if (token === "--list-accounts" || token.startsWith("--list-accounts=")) {
      if (listFormat !== null) fail("error: --list-accounts specified more than once", 2);
      const value = token.startsWith("--list-accounts=")
        ? token.slice("--list-accounts=".length)
        : "text";
      if (value !== "text" && value !== "json") {
        fail(`error: --list-accounts format must be text or json (got '${value}')`, 2);
      }
      listFormat = value;
      continue;
    }
    if (token === "--yes" && removeName !== null) {
      removeYes = true;
      continue;
    }
    strippedArgs.push(token);
    if (VALUE_FLAGS.has(token) && i + 1 < input.length) {
      strippedArgs.push(input[++i] || "");
    } else {
      leading = false;
    }
  }

  if (listFormat !== null && removeName !== null) {
    fail("error: --list-accounts and --remove-account cannot be combined", 2);
  }
  const reexecPrefix = accountName === null ? [] : ["--account", accountName];
  if (accountInit) reexecPrefix.push("--account-init");
  return {
    accountName,
    accountInit,
    listFormat,
    removeName,
    removeYes,
    strippedArgs,
    reexecPrefix,
    command: commandFrom(strippedArgs),
  };
}
