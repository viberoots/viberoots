import fs from "node:fs/promises";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
  type ArtifactCommandResult,
} from "../lib/artifact-command-runner";
import {
  installReviewedSshTransportAuthority,
  parseRemoteBuilderEndpoint,
  parseRemoteBuilderTransportFile,
} from "./remote-builder-ssh-authority";

type RunNix = (args: string[], env: NodeJS.ProcessEnv) => Promise<ArtifactCommandResult>;

function immutableStoreRoot(value: string, name: string): string {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(value))
    throw new Error(`${name} must be an immutable Nix store root`);
  return value;
}

export async function importRemoteBuilderAuthorities(opts: {
  nix: string;
  endpointPath: string;
  transportFile: string;
  policyStorePath: string;
  probeFlakeStorePath: string;
  env: NodeJS.ProcessEnv;
  runNix?: RunNix;
}): Promise<void> {
  const policyStorePath = immutableStoreRoot(opts.policyStorePath, "policy assertion");
  const probeFlakeStorePath = immutableStoreRoot(opts.probeFlakeStorePath, "probe flake");
  const endpoint = parseRemoteBuilderEndpoint(
    JSON.parse(await fs.readFile(opts.endpointPath, "utf8")),
  );
  const transport = parseRemoteBuilderTransportFile(opts.transportFile, endpoint);
  const env = installReviewedSshTransportAuthority(opts.env, endpoint, transport.sshKeyFile);
  const run =
    opts.runNix ||
    ((args, childEnv) =>
      runBoundedArtifactCommand({
        command: opts.nix,
        args,
        env: childEnv,
        timeoutMs: 600_000,
      }));
  const copied = await run(
    ["copy", "--from", transport.credentialFreeBuilderUri, policyStorePath, probeFlakeStorePath],
    env,
  );
  assertArtifactCommandSucceeded("remote builder authority import", copied);
  const verified = await run(
    ["store", "verify", "--recursive", "--no-trust", policyStorePath, probeFlakeStorePath],
    env,
  );
  assertArtifactCommandSucceeded("imported remote builder authority verification", verified);
}
