import * as fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as readline from "node:readline/promises";
import path from "node:path";
import process from "node:process";
import type { DeploymentBootstrapScope } from "../../deployments/infisical-iac-bootstrap-config";
import { runNodeWithZx } from "../../lib/node-run";
import { PROJECT_SHARED_CONFIG_PATH } from "../../deployments/project-config";
import { loadDeploymentReadinessModules, sinkFromSelection } from "./secret-readiness-modules";
import { buildToolPath, zxInitPath } from "../dev-build/paths";

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

const deploymentMetadataRoot = path.join("projects", "deployments");
const familyMetadataSuffix = path.join("shared", "family.bzl");

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
    readDeploymentReviewedMetadata,
    readSprinkleRefConfig,
    repoBootstrapCredentialRefs,
    resolveBootstrapAccessCredentialSinkBackend,
    resolveCredentialSinkSelection,
  } = await loadDeploymentReadinessModules();
  const configPath = process.env.SPRINKLEREF_CONFIG || "";
  const metadataPaths = await discoverDeploymentFamilyMetadataPaths(repoRoot);
  try {
    await readSprinkleRefConfig(configPath, repoRoot);
  } catch (error) {
    if (!isResolverConfigAbsenceError(error)) throw error;
    return { ready: false, reason: "missing resolver config" };
  }
  const args = {
    ...DEFAULT_BOOTSTRAP_ARGS,
    yes: true,
    localCredentialFile: path.join(repoRoot, DEFAULT_BOOTSTRAP_ARGS.localCredentialFile),
  };
  const selection = await resolveCredentialSinkSelection(args, {
    createMissingResolverConfig: false,
    env: process.env.SPRINKLEREF_CONFIG
      ? { ...process.env, SPRINKLEREF_CONFIG: process.env.SPRINKLEREF_CONFIG }
      : { ...process.env, SPRINKLEREF_CONFIG: path.join(repoRoot, PROJECT_SHARED_CONFIG_PATH) },
  });
  const sink = await sinkFromSelection(args, selection, repoRoot, {
    LocalFileCredentialSink,
    createSprinkleRefStore,
    readSprinkleRefConfig,
    resolveBootstrapAccessCredentialSinkBackend,
  });
  const repoRefs = repoBootstrapCredentialRefs({ name: args.identityName });
  const requiredRefs = [repoRefs.clientIdRef, repoRefs.clientSecretRef];
  for (const metadataPath of metadataPaths) {
    const metadata = await readDeploymentReviewedMetadata(
      deploymentScopeFromMetadataPath(repoRoot, metadataPath),
      metadataPath,
      repoRoot,
    );
    for (const item of metadata.deploymentCredentials) {
      requiredRefs.push(item.clientIdRef, item.clientSecretRef);
    }
  }
  for (const ref of requiredRefs) {
    if (!(await sink.has(ref)))
      return { ready: false, reason: "missing local Universal Auth credentials" };
  }
  return { ready: true, reason: "ready" };
}

export async function isInstallSecretReadinessApplicable(repoRoot = process.cwd()) {
  return (await discoverDeploymentFamilyMetadataPaths(repoRoot)).length > 0;
}

async function discoverDeploymentFamilyMetadataPaths(repoRoot: string) {
  const deploymentsRoot = path.join(repoRoot, deploymentMetadataRoot);
  const found: string[] = [];
  await walkDeployments(deploymentsRoot, found);
  return found.sort();
}

function deploymentScopeFromMetadataPath(
  repoRoot: string,
  metadataPath: string,
): DeploymentBootstrapScope {
  const relative = path.relative(repoRoot, metadataPath).split(path.sep).join("/");
  const match = relative.match(/^projects\/deployments\/([^/]+)\/shared\/family\.bzl$/);
  if (!match?.[1]) {
    throw new Error(
      `deployment metadata path ${relative} is not supported; expected projects/deployments/<family>/shared/family.bzl`,
    );
  }
  const family = match[1];
  return {
    target: `//projects/deployments/${family}/shared:family`,
    family,
    stage: "shared",
    reviewedMetadataPath: relative,
    reviewedContextConfigPath: PROJECT_SHARED_CONFIG_PATH,
    tofuDir: `projects/deployments/${family}/infisical/opentofu`,
  };
}

async function walkDeployments(dir: string, found: string[]) {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isFileAbsenceError(error)) return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    const metadataPath = path.join(child, familyMetadataSuffix);
    try {
      await fsp.access(metadataPath);
      found.push(metadataPath);
    } catch (error) {
      if (!isFileAbsenceError(error)) throw error;
    }
    await walkDeployments(child, found);
  }
}

function isFileAbsenceError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isResolverConfigAbsenceError(error: unknown) {
  if (isFileAbsenceError(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /missing projects\/config\/shared\.json sprinkleref config/.test(message);
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
    script: buildToolPath(repoRoot, "tools/deployments/infisical-bootstrap.ts"),
    args,
    zxInitPath: zxInitPath(repoRoot),
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
