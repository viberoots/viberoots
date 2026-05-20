import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import type { CredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { resolveBootstrapAccessCredentialSinkBackend } from "./sprinkleref-bootstrap-guard";
import { macosKeychainCommand, type KeychainRunner } from "./sprinkleref-keychain";

const VALIDATION_ACCOUNT = "viberoots-bootstrap-keychain-validation";

export async function materializeBootstrapCredentialSink(opts: {
  args: BootstrapArgs;
  selection: CredentialSinkSelection;
  keychainRunner?: KeychainRunner;
  platform?: NodeJS.Platform;
}) {
  const file = await localSinkFile(opts.args, opts.selection);
  if (!file) {
    const service = await keychainService(opts.args, opts.selection);
    if (service) {
      return await validateMacosKeychainBootstrapSink({
        service,
        platform: opts.platform,
        runner: opts.keychainRunner || defaultKeychainRunner,
      });
    }
    return { materialized: false, kind: opts.selection.backend || opts.selection.kind };
  }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(file, "{}\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await fs.chmod(file, 0o600);
  return { materialized: true, kind: "local-file", file };
}

export async function validateMacosKeychainBootstrapSink(opts: {
  service: string;
  platform?: NodeJS.Platform;
  runner: KeychainRunner;
}) {
  const platform = opts.platform || process.platform;
  if (platform !== "darwin") {
    throw new Error("macos-keychain bootstrap sink requires macOS; use local-file on this host");
  }
  const result = opts.runner(
    "security",
    macosKeychainCommand("read", opts.service, VALIDATION_ACCOUNT),
  );
  if (result.status !== 0 && result.status !== 44) {
    throw new Error(
      `macOS Keychain service ${opts.service} is not usable for bootstrap credentials; verify Keychain access or use --credential-sink local-file`,
    );
  }
  return { materialized: false, kind: "macos-keychain", service: opts.service };
}

async function localSinkFile(args: BootstrapArgs, selection: CredentialSinkSelection) {
  if (selection.kind === "local-file") return args.localCredentialFile;
  if (selection.kind !== "sprinkleref" || selection.backend !== "local-file") return undefined;
  const config = await readSprinkleRefConfig(selection.configPath);
  const resolved = resolveBootstrapAccessCredentialSinkBackend(
    config,
    selection.category || args.sprinkleCategory || "bootstrap",
  );
  return resolved.backend.file;
}

async function keychainService(args: BootstrapArgs, selection: CredentialSinkSelection) {
  if (selection.kind === "macos-keychain") return selection.description;
  if (selection.kind !== "sprinkleref" || selection.backend !== "macos-keychain") return undefined;
  const config = await readSprinkleRefConfig(selection.configPath);
  const resolved = resolveBootstrapAccessCredentialSinkBackend(
    config,
    selection.category || args.sprinkleCategory || "bootstrap",
  );
  return resolved.backend.service;
}

function defaultKeychainRunner(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}
