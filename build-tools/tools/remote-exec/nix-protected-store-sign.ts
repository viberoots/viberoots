#!/usr/bin/env zx-wrapper
import { getFlagStr } from "../lib/cli";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
} from "../lib/artifact-command-runner";
import { signAndVerifyProtectedStore } from "../lib/protected-store-signature";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { remoteAdminToolsPathEnv } from "./nix-remote-builder-environment";

export async function signProtectedStoreRoot(opts: {
  storeRoot: string;
  signingKeyFile: string;
  remoteCiTools: string;
  baseEnv?: NodeJS.ProcessEnv;
}): Promise<string> {
  const env = remoteAdminToolsPathEnv(
    opts.remoteCiTools,
    opts.baseEnv || artifactTransportEnvironment(process.env),
  );
  const nix = ensureNixStoreToolPathSync("nix", env);
  return await signAndVerifyProtectedStore(opts.storeRoot, opts.signingKeyFile, async (args) => {
    const result = await runBoundedArtifactCommand({
      command: nix,
      args,
      env,
      timeoutMs: 120_000,
    });
    assertArtifactCommandSucceeded(`nix store ${args[1] || "operation"}`, result);
    return result;
  });
}

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const root = await signProtectedStoreRoot({
    storeRoot: required("store-root"),
    signingKeyFile: required("signing-key-file"),
    remoteCiTools: required("remote-ci-tools"),
  });
  process.stdout.write(`${root}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
