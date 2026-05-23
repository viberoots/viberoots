import * as readline from "node:readline/promises";
import path from "node:path";
import process from "node:process";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { repoBootstrapCredentialRefs } from "../../deployments/infisical-iac-bootstrap-identity";
import { resolverConfigPath } from "../../deployments/infisical-iac-bootstrap-preflight";
import { readPleominoReviewedMetadata } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";
import {
  LocalFileCredentialSink,
  resolveCredentialSinkSelection,
  type CredentialSinkSelection,
} from "../../deployments/infisical-iac-bootstrap-sink";
import { resolveBootstrapAccessCredentialSinkBackend } from "../../deployments/sprinkleref-bootstrap-guard";
import { readSprinkleRefConfig } from "../../deployments/sprinkleref-config";
import { createSprinkleRefStore } from "../../deployments/sprinkleref-store";
import type {
  BootstrapArgs,
  CredentialSink,
} from "../../deployments/infisical-iac-bootstrap-types";
import { runNodeWithZx } from "../../lib/node-run";

export type SecretReadinessFlags = {
  withoutSecrets: boolean;
  yes: boolean;
  machineLabel: string;
  rotateBootstrapCredentials: boolean;
  rotateDeploymentCredentials: boolean;
  forceOverwriteLocalCredentials: boolean;
};

export type SecretReadinessDeps = {
  isInteractive?: () => boolean;
  prompt?: (message: string) => Promise<boolean>;
  bootstrap?: (args: string[]) => Promise<void>;
};

export async function ensureInstallSecretReadiness(opts: {
  repoRoot: string;
  dryRun: boolean;
  verbose: boolean;
  flags: SecretReadinessFlags;
  deps?: SecretReadinessDeps;
}) {
  if (opts.flags.withoutSecrets || opts.dryRun) {
    if (opts.verbose) console.log("[install-deps] skipping Infisical secret readiness");
    return;
  }
  const probe = await probeLocalSecretReadiness(opts.repoRoot);
  if (probe.ready) {
    if (opts.verbose) console.log("[install-deps] Infisical local secret readiness ok");
    if (hasRotationRequest(opts.flags)) {
      await runRepoBootstrap(opts);
    }
    return;
  }
  if (opts.verbose)
    console.log(`[install-deps] Infisical local readiness missing: ${probe.reason}`);
  const allowed = opts.flags.yes || process.env.INSTALL_DEPS_SETUP_SECRETS === "1";
  const interactive = opts.deps?.isInteractive?.() ?? isInteractiveShell();
  if (!allowed && !interactive) throw new Error(nonInteractiveMessage());
  if (!allowed) {
    const confirmed =
      (await (opts.deps?.prompt || promptYesNo)(
        "Infisical local credentials are not ready. Run repo bootstrap now? [Y/n] ",
      )) ?? false;
    if (!confirmed) {
      console.error("Infisical setup skipped. Rerun `i` and accept the prompt when ready.");
      return;
    }
  }
  await runRepoBootstrap(opts);
}

export async function probeLocalSecretReadiness(repoRoot = process.cwd()) {
  const configPath = process.env.SPRINKLEREF_CONFIG || path.join(repoRoot, resolverConfigPath());
  try {
    await readSprinkleRefConfig(configPath);
  } catch {
    return { ready: false, reason: "missing resolver config" };
  }
  try {
    const args = {
      ...DEFAULT_BOOTSTRAP_ARGS,
      yes: true,
      localCredentialFile: path.join(repoRoot, DEFAULT_BOOTSTRAP_ARGS.localCredentialFile),
    };
    const selection = await resolveCredentialSinkSelection(args, {
      createMissingResolverConfig: false,
      env: { ...process.env, SPRINKLEREF_CONFIG: configPath },
    });
    const sink = await sinkFromSelection(args, selection, repoRoot);
    const repoRefs = repoBootstrapCredentialRefs({ name: args.identityName });
    const requiredRefs = [repoRefs.clientIdRef, repoRefs.clientSecretRef];
    const metadata = await readPleominoReviewedMetadata(
      path.join(repoRoot, "projects/deployments/pleomino/shared/family.bzl"),
    );
    for (const item of metadata.deploymentCredentials) {
      requiredRefs.push(item.clientIdRef, item.clientSecretRef);
    }
    for (const ref of requiredRefs) {
      if (!(await sink.has(ref)))
        return { ready: false, reason: "missing local Universal Auth credentials" };
    }
    return { ready: true, reason: "ready" };
  } catch {
    return { ready: false, reason: "missing local Universal Auth credentials" };
  }
}

async function sinkFromSelection(
  args: BootstrapArgs,
  selection: CredentialSinkSelection,
  repoRoot: string,
): Promise<CredentialSink> {
  if (selection.kind === "local-file") {
    return new LocalFileCredentialSink(args.localCredentialFile);
  }
  const config = await readSprinkleRefConfig(selection.configPath);
  const resolved = resolveBootstrapAccessCredentialSinkBackend(
    config,
    selection.category || args.sprinkleCategory || "bootstrap",
  );
  const store = createSprinkleRefStore(absolutizeLocalFileBackend(resolved.backend, repoRoot));
  return {
    describe: () => store.describe(),
    has: (ref) => store.has(ref),
    read: (ref) => store.read(ref),
    write: async (ref, value, overwrite) => {
      if (overwrite && (await store.has(ref))) return await store.update(ref, value);
      await store.add(ref, value);
    },
  };
}

function absolutizeLocalFileBackend<T extends { backend: string; file?: string }>(
  backend: T,
  repoRoot: string,
): T {
  if (backend.backend !== "local-file" || !backend.file || path.isAbsolute(backend.file)) {
    return backend;
  }
  return { ...backend, file: path.join(repoRoot, backend.file) };
}

function bootstrapArgs(flags: SecretReadinessFlags) {
  return [
    "repo",
    "--yes",
    ...valueFlag("machine-label", flags.machineLabel),
    ...boolFlag("rotate-bootstrap-credentials", flags.rotateBootstrapCredentials),
    ...boolFlag("rotate-deployment-credentials", flags.rotateDeploymentCredentials),
    ...boolFlag("force-overwrite-local-credentials", flags.forceOverwriteLocalCredentials),
  ];
}

function hasRotationRequest(flags: SecretReadinessFlags) {
  return flags.rotateBootstrapCredentials || flags.rotateDeploymentCredentials;
}

async function runRepoBootstrap(opts: {
  repoRoot: string;
  flags: SecretReadinessFlags;
  deps?: SecretReadinessDeps;
}) {
  await (opts.deps?.bootstrap || ((args) => runBootstrap(opts.repoRoot, args)))(
    bootstrapArgs(opts.flags),
  );
}

async function runBootstrap(repoRoot: string, args: string[]) {
  await runNodeWithZx({
    cwd: repoRoot,
    script: `${repoRoot}/build-tools/tools/deployments/infisical-bootstrap.ts`,
    args,
    zxInitPath: `${repoRoot}/build-tools/tools/dev/zx-init.mjs`,
    stdio: "inherit",
  });
}

function boolFlag(name: string, enabled: boolean) {
  return enabled ? [`--${name}`] : [];
}

function valueFlag(name: string, value: string) {
  return value.trim() ? [`--${name}`, value.trim()] : [];
}

function isInteractiveShell() {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

async function promptYesNo(message: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function nonInteractiveMessage() {
  return [
    "Infisical local credentials are not ready.",
    "Rerun `i --yes` to allow local repo bootstrap, or use `i --without-secrets` for dependency-only setup.",
  ].join(" ");
}
