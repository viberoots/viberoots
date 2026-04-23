#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type InstallClientSshAuthInput = {
  destination: string;
  sshIdentityFile?: string;
  sshKnownHostsFile?: string;
};

type ResolvedInstallClientSshAuth = {
  sshIdentityFile?: string;
  sshKnownHostsFile?: string;
};

type ParsedDestination = {
  destination: string;
  host: string;
};

const STANDARD_IDENTITY_FILES = ["id_ed25519", "id_ecdsa", "id_rsa"] as const;
const STANDARD_KNOWN_HOSTS_FILES = ["known_hosts", "known_hosts2"] as const;

function trimValue(value: string | undefined): string | undefined {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
}

function parseDestination(destination: string): ParsedDestination {
  const trimmed = destination.trim();
  const atIndex = trimmed.lastIndexOf("@");
  return {
    destination: trimmed,
    host: atIndex >= 0 ? trimmed.slice(atIndex + 1) : trimmed,
  };
}

function sshHomeDir(env: NodeJS.ProcessEnv): string {
  const home = String(env.HOME || os.homedir() || "").trim();
  return home ? path.resolve(home) : "";
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fsp.stat(filePath)).isFile();
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function pathFromSshConfig(rawValue: string, homeDir: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error("expected SSH config path value");
  if (trimmed.includes("%")) {
    throw new Error(`unsupported SSH config token path "${trimmed}"`);
  }
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) return path.join(homeDir, trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return path.resolve(homeDir, trimmed);
}

function normalizeTokens(tokens: string[]): string[] {
  const compact = tokens.filter((token) => token !== "=");
  if (!compact.length) return compact;
  if (compact[0]?.endsWith("=")) {
    compact[0] = compact[0].slice(0, -1);
  }
  if (compact[1]?.startsWith("=")) {
    compact[1] = compact[1].slice(1);
    if (!compact[1]) compact.splice(1, 1);
  }
  return compact;
}

function tokenizeSshConfigLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;
  for (const char of line) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = undefined;
      continue;
    }
    if (!quote && char === "#") break;
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += "\\";
  if (current) tokens.push(current);
  return normalizeTokens(tokens);
}

function hostPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`, "i");
}

function hostLineMatches(patterns: string[], destination: ParsedDestination): boolean {
  const candidates = new Set(
    [destination.destination, destination.host].map((value) => value.toLowerCase()),
  );
  let matched = false;
  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;
    const negated = pattern.startsWith("!");
    const expr = hostPatternToRegExp((negated ? pattern.slice(1) : pattern).toLowerCase());
    const didMatch = Array.from(candidates).some((candidate) => expr.test(candidate));
    if (negated && didMatch) return false;
    if (!negated && didMatch) matched = true;
  }
  return matched;
}

async function resolveConfiguredFile(opts: {
  configuredPath: string | undefined;
  label: string;
  homeDir: string;
  destination: string;
}): Promise<string | undefined> {
  const configuredPath = trimValue(opts.configuredPath);
  if (!configuredPath) return undefined;
  let resolvedPath = "";
  try {
    resolvedPath = pathFromSshConfig(configuredPath, opts.homeDir);
  } catch (error) {
    throw new Error(
      `client install could not infer ${opts.label} from SSH config for destination "${opts.destination}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!(await isFile(resolvedPath))) {
    throw new Error(
      `client install could not infer ${opts.label} from SSH config for destination "${opts.destination}": missing file "${resolvedPath}"`,
    );
  }
  return resolvedPath;
}

async function guessFromSshConfig(
  destination: string,
  env: NodeJS.ProcessEnv,
): Promise<{ identityFile?: string; knownHostsFile?: string }> {
  const homeDir = sshHomeDir(env);
  if (!homeDir) return {};
  const configPath = path.join(homeDir, ".ssh", "config");
  let text = "";
  try {
    text = await fsp.readFile(configPath, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const parsedDestination = parseDestination(destination);
  let active = true;
  let identityFile: string | undefined;
  let knownHostsFile: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const tokens = tokenizeSshConfigLine(line);
    if (!tokens.length) continue;
    const [keyword, ...values] = tokens;
    const normalized = keyword.toLowerCase();
    if (normalized === "host") {
      active = hostLineMatches(values, parsedDestination);
      continue;
    }
    if (!active) continue;
    if (normalized === "identityfile" && !identityFile) {
      if (values.length !== 1) {
        throw new Error(
          `client install found an ambiguous SSH IdentityFile entry for destination "${destination}" in ${configPath}`,
        );
      }
      identityFile = values[0];
      continue;
    }
    if (normalized === "userknownhostsfile" && !knownHostsFile) {
      if (values.length !== 1) {
        throw new Error(
          `client install found an ambiguous SSH UserKnownHostsFile entry for destination "${destination}" in ${configPath}`,
        );
      }
      knownHostsFile = values[0];
    }
  }
  return {
    identityFile: await resolveConfiguredFile({
      configuredPath: identityFile,
      label: "SSH identity file",
      homeDir,
      destination,
    }),
    knownHostsFile: await resolveConfiguredFile({
      configuredPath: knownHostsFile,
      label: "SSH known hosts file",
      homeDir,
      destination,
    }),
  };
}

async function pickSingleExistingFile(opts: {
  directory: string;
  basenames: readonly string[];
  label: string;
  destination: string;
}): Promise<string | undefined> {
  const matches: string[] = [];
  for (const basename of opts.basenames) {
    const candidate = path.join(opts.directory, basename);
    if (await isFile(candidate)) matches.push(candidate);
  }
  if (!matches.length) return undefined;
  if (matches.length === 1) return matches[0];
  throw new Error(
    `client install found multiple plausible ${opts.label} files for destination "${opts.destination}": ${matches.join(", ")}; pass --ssh-identity-file and --ssh-known-hosts explicitly`,
  );
}

async function guessInstallClientSshAuth(
  destination: string,
  env: NodeJS.ProcessEnv,
): Promise<{ identityFile?: string; knownHostsFile?: string }> {
  const homeDir = sshHomeDir(env);
  if (!homeDir) return {};
  const fromConfig = await guessFromSshConfig(destination, env);
  const sshDir = path.join(homeDir, ".ssh");
  return {
    identityFile:
      fromConfig.identityFile ||
      (await pickSingleExistingFile({
        directory: sshDir,
        basenames: STANDARD_IDENTITY_FILES,
        label: "SSH identity",
        destination,
      })),
    knownHostsFile:
      fromConfig.knownHostsFile ||
      (await pickSingleExistingFile({
        directory: sshDir,
        basenames: STANDARD_KNOWN_HOSTS_FILES,
        label: "SSH known-hosts",
        destination,
      })),
  };
}

export async function resolveClientInstallSshAuthDefaults(
  input: InstallClientSshAuthInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedInstallClientSshAuth> {
  const sshIdentityFile = trimValue(input.sshIdentityFile);
  const sshKnownHostsFile = trimValue(input.sshKnownHostsFile);
  if (sshIdentityFile && sshKnownHostsFile) {
    return { sshIdentityFile, sshKnownHostsFile };
  }
  const guessed = await guessInstallClientSshAuth(input.destination, env);
  const resolvedIdentityFile = sshIdentityFile || guessed.identityFile;
  const resolvedKnownHostsFile = sshKnownHostsFile || guessed.knownHostsFile;
  if (!resolvedIdentityFile && !resolvedKnownHostsFile) return {};
  if (!resolvedIdentityFile || !resolvedKnownHostsFile) {
    throw new Error(
      `client install could not infer reviewed SSH auth for destination "${input.destination}"; pass --ssh-identity-file and --ssh-known-hosts explicitly`,
    );
  }
  return {
    sshIdentityFile: resolvedIdentityFile,
    sshKnownHostsFile: resolvedKnownHostsFile,
  };
}
