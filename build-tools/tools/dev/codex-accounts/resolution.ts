import * as fsp from "node:fs/promises";
import * as path from "node:path";

import { accountEmail } from "./email";
import { fail } from "./errors";
import { hasConfig, inspectAuthentication } from "./auth-state";
import { accountNameError, isValidAccountName } from "./name";
import type { ParsedAccountArgs, Resolution } from "./types";

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fsp.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function canonicalAccountRoot(root: string, create: boolean): Promise<string> {
  if (create) {
    try {
      await fsp.mkdir(root);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    }
  }
  try {
    const stat = await fsp.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail(`error: codex account root must be a real directory, not a symlink: ${root}`, 2);
    }
    return await fsp.realpath(root);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    const parent = await fsp.realpath(path.dirname(root));
    return path.join(parent, path.basename(root));
  }
}

export async function validateNamedPath(root: string, name: string): Promise<string> {
  const rootReal = await canonicalAccountRoot(root, false);
  const candidate = path.join(rootReal, name);
  try {
    await fsp.lstat(candidate);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return candidate;
    throw error;
  }
  if (!(await isDirectory(candidate))) {
    fail(`error: codex account '${name}' is not a canonical account directory`, 2);
  }
  const candidateReal = await fsp.realpath(candidate);
  const relative = path.relative(rootReal, candidateReal);
  if (relative !== name || path.dirname(candidateReal) !== rootReal) {
    fail(`error: codex account '${name}' resolves outside its canonical account directory`, 2);
  }
  return candidateReal;
}

export async function ensureNamedAccountDirectory(root: string, name: string): Promise<string> {
  const rootReal = await canonicalAccountRoot(root, true);
  const candidate = path.join(rootReal, name);
  try {
    await fsp.mkdir(candidate);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  }
  return await validateNamedPath(rootReal, name);
}

async function resolveDefault(root: string): Promise<Resolution | null> {
  const link = path.join(root, "default");
  let linkStat;
  try {
    linkStat = await fsp.lstat(link);
  } catch {
    return null;
  }
  if (!linkStat.isSymbolicLink()) {
    return {
      source: "none",
      accountName: null,
      codexHome: null,
      warnings: [`warn: ${link} is not a symlink; falling through to legacy Codex state`],
    };
  }
  const target = await fsp.readlink(link);
  if (path.isAbsolute(target) || target !== path.basename(target) || !isValidAccountName(target)) {
    return {
      source: "none",
      accountName: null,
      codexHome: null,
      warnings: [
        `warn: ${link} has invalid target '${target}'; expected one validated relative account name`,
        "  falling through to ~/.codex/ (legacy)",
      ],
    };
  }
  try {
    const resolved = await validateNamedPath(root, target);
    if (!(await isDirectory(resolved))) {
      return {
        source: "none",
        accountName: null,
        codexHome: null,
        warnings: [
          `warn: ${link} -> ${target}, but the target does not exist`,
          "  falling through to ~/.codex/ (legacy)",
        ],
      };
    }
    const auth = await inspectAuthentication(resolved);
    if (!auth.usable && !(await hasConfig(resolved))) {
      return {
        source: "none",
        accountName: null,
        codexHome: null,
        warnings: [
          `warn: ${link} -> ${target}, but the target has no usable auth.json or config.toml`,
          "  falling through to ~/.codex/ (legacy)",
        ],
      };
    }
    return { source: "default", accountName: target, codexHome: resolved, warnings: [] };
  } catch (error: unknown) {
    return {
      source: "none",
      accountName: null,
      codexHome: null,
      warnings: [
        `warn: ${link} cannot resolve to a canonical account within ${root}`,
        `  ${String((error as Error)?.message || error)}`,
        "  falling through to ~/.codex/ (legacy)",
      ],
    };
  }
}

async function addIdentityConflictWarning(
  result: Resolution,
  legacyRoot: string,
): Promise<Resolution> {
  if (result.source !== "default" || !(await isDirectory(legacyRoot))) return result;
  const [selectedEmail, legacyEmail] = await Promise.all([
    accountEmail(result.codexHome || ""),
    accountEmail(legacyRoot),
  ]);
  if (selectedEmail && legacyEmail && selectedEmail !== legacyEmail) {
    result.warnings.push(
      `warn: default account (email: ${selectedEmail}) and legacy ~/.codex/ (email: ${legacyEmail}) hold different valid auth`,
      "  using the default account per precedence; pass --account to select another account",
    );
  }
  return result;
}

export async function resolveAccount(
  parsed: ParsedAccountArgs,
  root: string,
  legacyRoot: string,
): Promise<Resolution> {
  if (parsed.accountName) {
    const codexHome = await validateNamedPath(root, parsed.accountName);
    const warnings =
      process.env.CODEX_HOME && process.env.CODEX_HOME !== codexHome
        ? [`warn: --account '${parsed.accountName}' overrides CODEX_HOME=${process.env.CODEX_HOME}`]
        : [];
    return { source: "cli", accountName: parsed.accountName, codexHome, warnings };
  }
  if (process.env.CODEX_HOME) {
    return {
      source: "codex-home",
      accountName: null,
      codexHome: process.env.CODEX_HOME,
      warnings: [],
    };
  }
  if (Object.hasOwn(process.env, "CODEX_ACCOUNT")) {
    const name = process.env.CODEX_ACCOUNT || "";
    if (!isValidAccountName(name))
      fail(name.length === 0 ? "error: CODEX_ACCOUNT is empty" : accountNameError(name), 2);
    return {
      source: "env",
      accountName: name,
      codexHome: await validateNamedPath(root, name),
      warnings: [],
    };
  }
  const fromDefault = await resolveDefault(root);
  if (fromDefault?.codexHome) {
    return await addIdentityConflictWarning(fromDefault, legacyRoot);
  }
  const warnings = fromDefault?.warnings || [];
  if (await isDirectory(legacyRoot)) {
    return { source: "legacy", accountName: null, codexHome: legacyRoot, warnings };
  }
  return { source: "none", accountName: null, codexHome: null, warnings };
}
