#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { guessFromSshConfig } from "./nixos-shared-host-install-ssh-config";

type InstallClientSshAuthInput = {
  destination: string;
  sshIdentityFile?: string;
  sshKnownHostsFile?: string;
};

type ResolvedInstallClientSshAuth = {
  sshIdentityFile?: string;
  sshKnownHostsFile?: string;
};

const STANDARD_IDENTITY_FILES = ["id_ed25519", "id_ecdsa", "id_rsa"] as const;
const STANDARD_KNOWN_HOSTS_FILES = ["known_hosts", "known_hosts2"] as const;

function trimValue(value: string | undefined): string | undefined {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
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
