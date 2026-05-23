import * as fsp from "node:fs/promises";
import * as readline from "node:readline/promises";
import path from "node:path";
import process from "node:process";
import { runNodeWithZx } from "../../lib/node-run";
import { loadDeploymentReadinessModules, sinkFromSelection } from "./secret-readiness-modules";

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
  probe?: (repoRoot: string) => Promise<SecretReadinessProbe>;
};

type SecretReadinessProbe = {
  ready: boolean;
  reason: string;
};

const pleominoFamilyMetadataPath = "projects/deployments/pleomino/shared/family.bzl";
const resolverConfigRelativePath = path.join("sprinkleref", "selected.local.json");

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
  if (!(await isInstallSecretReadinessApplicable(opts.repoRoot))) {
    if (opts.verbose) {
      console.log("[install-deps] Infisical secret readiness not applicable in this checkout");
    }
    return;
  }
  const probe = await (opts.deps?.probe || probeLocalSecretReadiness)(opts.repoRoot);
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
  if (!(await isInstallSecretReadinessApplicable(repoRoot))) {
    return { ready: true, reason: "not applicable in this checkout" };
  }
  const {
    DEFAULT_BOOTSTRAP_ARGS,
    LocalFileCredentialSink,
    createSprinkleRefStore,
    readPleominoReviewedMetadata,
    readSprinkleRefConfig,
    repoBootstrapCredentialRefs,
    resolveBootstrapAccessCredentialSinkBackend,
    resolveCredentialSinkSelection,
  } = await loadDeploymentReadinessModules();
  const configPath =
    process.env.SPRINKLEREF_CONFIG || path.join(repoRoot, resolverConfigRelativePath);
  const metadata = await readPleominoReviewedMetadata(
    path.join(repoRoot, pleominoFamilyMetadataPath),
  );
  try {
    await readSprinkleRefConfig(configPath);
  } catch (error) {
    if (!isFileAbsenceError(error)) throw error;
    return { ready: false, reason: "missing resolver config" };
  }
  const args = {
    ...DEFAULT_BOOTSTRAP_ARGS,
    yes: true,
    localCredentialFile: path.join(repoRoot, DEFAULT_BOOTSTRAP_ARGS.localCredentialFile),
  };
  const selection = await resolveCredentialSinkSelection(args, {
    createMissingResolverConfig: false,
    env: { ...process.env, SPRINKLEREF_CONFIG: configPath },
  });
  const sink = await sinkFromSelection(args, selection, repoRoot, {
    LocalFileCredentialSink,
    createSprinkleRefStore,
    readSprinkleRefConfig,
    resolveBootstrapAccessCredentialSinkBackend,
  });
  const repoRefs = repoBootstrapCredentialRefs({ name: args.identityName });
  const requiredRefs = [repoRefs.clientIdRef, repoRefs.clientSecretRef];
  for (const item of metadata.deploymentCredentials) {
    requiredRefs.push(item.clientIdRef, item.clientSecretRef);
  }
  for (const ref of requiredRefs) {
    if (!(await sink.has(ref)))
      return { ready: false, reason: "missing local Universal Auth credentials" };
  }
  return { ready: true, reason: "ready" };
}

export async function isInstallSecretReadinessApplicable(repoRoot = process.cwd()) {
  try {
    await fsp.access(path.join(repoRoot, pleominoFamilyMetadataPath));
    return true;
  } catch (error) {
    if (isFileAbsenceError(error)) return false;
    throw error;
  }
}

function isFileAbsenceError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
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
