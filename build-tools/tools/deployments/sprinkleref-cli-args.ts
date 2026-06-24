import { readFlagBoolFromTokens, readFlagStrFromTokens } from "../lib/argv";

export const VALUE_FLAGS = [
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

export const BOOL_FLAGS = [
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

export function validateKnownFlags(argv: string[], usageExit = false) {
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

export function positionalCommand(argv: string[]): { command: string; argv: string[] } {
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
