import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";

type Probe = {
  name: string;
  args: string[];
  outcome: "pass" | "deny";
  denialPattern?: RegExp;
};

function remoteProbeSet(opts: { probeFlake: string }): Probe[] {
  const common = [
    "build",
    ...artifactNixPolicyArgs(),
    "--option",
    "substitute",
    "false",
    "--no-link",
    "--rebuild",
  ];
  return [
    {
      name: "undeclared-store-canary-present",
      args: ["path-info", opts.probeFlake],
      outcome: "pass",
    },
    {
      name: "store",
      args: ["store", "info", "--json"],
      outcome: "pass",
    },
    {
      name: "fixed-output-correct-hash",
      args: [...common, `${opts.probeFlake}#remote-builder-fixed-output-correct-hash`],
      outcome: "pass",
    },
    {
      name: "ordinary-host-read",
      args: [...common, `${opts.probeFlake}#remote-builder-ordinary-host-read`],
      outcome: "deny",
      denialPattern: /viberoots-canary:host-read-denied/,
    },
    {
      name: "ordinary-network",
      args: [...common, `${opts.probeFlake}#remote-builder-ordinary-network`],
      outcome: "deny",
      denialPattern: /viberoots-canary:network-denied/,
    },
    {
      name: "fixed-output-wrong-hash",
      args: [...common, `${opts.probeFlake}#remote-builder-fixed-output-wrong-hash`],
      outcome: "deny",
      denialPattern: /hash mismatch|specified.*sha256|got:/i,
    },
  ];
}

async function runProbe(nix: string, probe: Probe, env: NodeJS.ProcessEnv): Promise<void> {
  const result = await runBoundedArtifactCommand({
    command: nix,
    args: probe.args,
    env,
    timeoutMs: 600_000,
  });
  if (result.timedOut || result.interrupted) {
    throw new Error(`remote builder ${probe.name} probe did not shut down cleanly`);
  }
  if (probe.outcome === "pass" && result.exitCode !== 0) {
    throw new Error(`remote builder ${probe.name} probe failed; inspect builder-local diagnostics`);
  }
  if (probe.outcome === "deny") {
    if (result.exitCode === 0)
      throw new Error(`remote builder ${probe.name} canary was not denied`);
    if (!probe.denialPattern?.test(result.stderr)) {
      throw new Error(`remote builder ${probe.name} failed without canary denial evidence`);
    }
  }
}

export async function runRemoteBuilderProbes(opts: {
  nix: string;
  probeFlake: string;
  env: NodeJS.ProcessEnv;
}): Promise<void> {
  for (const probe of remoteProbeSet(opts)) await runProbe(opts.nix, probe, opts.env);
}
