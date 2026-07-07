import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as readline from "node:readline/promises";
import path from "node:path";
import process from "node:process";
import type { DeploymentBootstrapScope } from "../../deployments/infisical-iac-bootstrap-config";
import {
  MacosKeychainInaccessibleError,
  type KeychainRunner,
} from "../../deployments/sprinkleref-keychain";
import { runNodeWithZx } from "../../lib/node-run";
import { PROJECT_SHARED_CONFIG_PATH } from "../../deployments/project-config";
import {
  hasResetPlanItems,
  runInfisicalBootstrapResetLocal,
  type LocalBootstrapResetPlan,
} from "../../deployments/infisical-bootstrap-reset-local";
import { loadDeploymentReadinessModules, sinkFromSelection } from "./secret-readiness-modules";
import { buildToolPath, zxInitPath } from "../dev-build/paths";
import { hasControllingTerminal, promptTerminalSelect } from "../../lib/terminal-select";

export type SecretReadinessFlags = {
  withoutSecrets: boolean;
  yes: boolean;
  machineLabel: string;
  rotateBootstrapCredentials: boolean;
  rotateDeploymentCredentials: boolean;
  forceOverwriteLocalCredentials: boolean;
  bootstrap: boolean;
  infisicalLoginMode: string;
  secretBackend: string;
  infisicalProjectName: string;
  selectInfisicalProject: boolean;
  bootstrapKeychainServiceName: string;
  keychainServiceName: string;
};

export type SecretReadinessDeps = {
  isInteractive?: () => boolean;
  prompt?: (message: string) => Promise<boolean>;
  selectSecretBackend?: () => Promise<string>;
  bootstrap?: (args: string[]) => Promise<void>;
  resetLocal?: (args: string[]) => Promise<LocalBootstrapResetPlan | void>;
  probe?: (repoRoot: string) => Promise<SecretReadinessProbe>;
};

type SecretReadinessProbe = {
  ready: boolean;
  reason: string;
};

type SecretReadinessProbeOpts = {
  platform?: NodeJS.Platform;
  keychainRunner?: KeychainRunner;
};

type ReadinessSprinkleRefConfig = {
  defaultCategory?: string;
  profiles?: Record<
    string,
    {
      backend?: string;
      generatedBy?: string;
      projectId?: string;
      projectIdEnv?: string;
      clientIdRef?: string;
      clientSecretRef?: string;
    }
  >;
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
  opts = { ...opts, flags: { ...opts.flags } };
  if (opts.flags.withoutSecrets && opts.flags.bootstrap) {
    throw new Error("--without-secrets cannot be combined with --bootstrap");
  }
  if (opts.flags.bootstrap) {
    return await runExplicitBootstrap(opts);
  }
  if (opts.flags.withoutSecrets || opts.dryRun) {
    if (opts.verbose) console.log("[install-deps] skipping Infisical secret readiness");
    return;
  }
  const readinessReason = await discoverInstallSecretReadinessReason(opts.repoRoot);
  if (!readinessReason) {
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
  if (isKeychainInaccessibleReason(probe.reason)) {
    throw new Error(`Infisical local credentials are not ready: ${probe.reason}`);
  }
  const allowed = opts.flags.yes || process.env.INSTALL_DEPS_SETUP_SECRETS === "1";
  const interactive = opts.deps?.isInteractive?.() ?? isInteractiveShell();
  if (!allowed && !interactive) throw new Error(nonInteractiveMessage());
  if (!allowed) {
    console.error(
      [
        `Local secret readiness is not complete: ${probe.reason}.`,
        "Repo bootstrap can repair resolver setup and local credentials.",
        `Infisical-backed selections use ${effectiveLoginMode(opts.flags)} login.`,
        loginModeHint(opts.flags),
      ].join(" "),
    );
    const confirmed =
      (await (opts.deps?.prompt || promptYesNo)("Run repo bootstrap now? [Y/n, then Enter] ")) ??
      false;
    if (!confirmed) {
      console.error("Infisical setup skipped. Rerun `i` and accept the prompt when ready.");
      return;
    }
  }
  await selectSecretBackendWhenInteractive(opts, interactive, allowed);
  console.error("[install-deps] starting repo bootstrap");
  await runRepoBootstrap(opts);
}

async function runExplicitBootstrap(opts: {
  repoRoot: string;
  dryRun: boolean;
  verbose: boolean;
  flags: SecretReadinessFlags;
  deps?: SecretReadinessDeps;
}) {
  if (opts.dryRun) {
    await runLocalReset(opts, ["--dry-run"]);
    if (opts.verbose) console.log("[install-deps] dry-run: would run Infisical repo bootstrap");
    return;
  }
  const allowed = opts.flags.yes || process.env.INSTALL_DEPS_SETUP_SECRETS === "1";
  const interactive = opts.deps?.isInteractive?.() ?? isInteractiveShell();
  if (!allowed && !interactive) throw new Error(nonInteractiveBootstrapMessage());
  if (interactive && !allowed) {
    const resetPlan = await runLocalReset(opts, ["--dry-run"]);
    if (hasResetPlanItems(resetPlan)) {
      const resetConfirmed =
        (await (opts.deps?.prompt || promptNoDefault)(
          "Reset local Infisical bootstrap state before continuing? [y/N] ",
        )) ?? false;
      if (resetConfirmed) await runLocalReset(opts, ["--yes"]);
    }
    await selectSecretBackendWhenInteractive(opts, interactive, allowed);
  }
  await runRepoBootstrap(opts);
}

export async function probeLocalSecretReadiness(
  repoRoot = process.cwd(),
  opts: SecretReadinessProbeOpts = {},
) {
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
    withBootstrapCredentialScope,
  } = await loadDeploymentReadinessModules();
  const configPath = process.env.SPRINKLEREF_CONFIG || "";
  const metadataPaths = await discoverDeploymentFamilyMetadataPaths(repoRoot);
  let config: ReadinessSprinkleRefConfig;
  try {
    config = (await readSprinkleRefConfig(configPath, repoRoot)) as ReadinessSprinkleRefConfig;
  } catch (error) {
    if (!isResolverConfigAbsenceError(error)) throw error;
    return { ready: false, reason: "missing resolver config" };
  }
  const args = await withBootstrapCredentialScope(
    {
      ...DEFAULT_BOOTSTRAP_ARGS,
      yes: true,
      localCredentialFile: path.join(repoRoot, DEFAULT_BOOTSTRAP_ARGS.localCredentialFile),
    },
    repoRoot,
  );
  const selection = await resolveCredentialSinkSelection(args, {
    createMissingResolverConfig: false,
    env: process.env.SPRINKLEREF_CONFIG
      ? { ...process.env, SPRINKLEREF_CONFIG: process.env.SPRINKLEREF_CONFIG }
      : { ...process.env, SPRINKLEREF_CONFIG: path.join(repoRoot, PROJECT_SHARED_CONFIG_PATH) },
  });
  const sink = await sinkFromSelection(
    args,
    selection,
    repoRoot,
    {
      LocalFileCredentialSink,
      createSprinkleRefStore,
      readSprinkleRefConfig,
      resolveBootstrapAccessCredentialSinkBackend,
    },
    opts,
  );
  const repoRefs = repoBootstrapCredentialRefsForReadiness(
    config,
    args,
    repoBootstrapCredentialRefs,
  );
  const unresolvedProfiles = unresolvedInfisicalProjectProfiles(config);
  if (unresolvedProfiles.length > 0) {
    return {
      ready: false,
      reason: `missing Infisical project id for profile(s): ${unresolvedProfiles.join(", ")}`,
    };
  }
  const requiredRefs = repoRefs.flatMap((refs) => [refs.clientIdRef, refs.clientSecretRef]);
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
    let present = false;
    try {
      present = await sink.has(ref);
    } catch (error) {
      if (error instanceof MacosKeychainInaccessibleError) {
        return { ready: false, reason: keychainInaccessibleReason(error) };
      }
      throw error;
    }
    if (!present) return { ready: false, reason: "missing local Universal Auth credentials" };
  }
  return { ready: true, reason: "ready" };
}

function repoBootstrapCredentialRefsForReadiness(
  config: ReadinessSprinkleRefConfig,
  args: { identityName: string; bootstrapCredentialScope?: string },
  repoBootstrapCredentialRefs: (
    identity: { name: string },
    bootstrapScope?: string,
  ) => { clientIdRef: string; clientSecretRef: string },
) {
  const configured = Object.values(config.profiles || {})
    .filter((profile) => profile.backend === "infisical")
    .flatMap((profile) =>
      profile.clientIdRef && profile.clientSecretRef
        ? [{ clientIdRef: profile.clientIdRef, clientSecretRef: profile.clientSecretRef }]
        : [],
    );
  if (configured.length > 0) return uniqueRefPairs(configured);
  return [repoBootstrapCredentialRefs({ name: args.identityName }, args.bootstrapCredentialScope)];
}

function unresolvedInfisicalProjectProfiles(config: ReadinessSprinkleRefConfig) {
  return activeInfisicalProfiles(config).flatMap(([name, profile]) => {
    if (profile.backend !== "infisical") return [];
    if (profile.projectId?.trim()) return [];
    if (profile.projectIdEnv && String(process.env[profile.projectIdEnv] || "").trim()) return [];
    return [name];
  });
}

function activeInfisicalProfiles(config: ReadinessSprinkleRefConfig) {
  const categories = (
    config as ReadinessSprinkleRefConfig & {
      categories?: Record<string, { profile?: string }>;
    }
  ).categories;
  const selected = config.defaultCategory || "main";
  const profileName = categories?.[selected]?.profile?.trim();
  if (!profileName) return [];
  const profile = config.profiles?.[profileName];
  return profile ? ([[profileName, profile]] as Array<[string, NonNullable<typeof profile>]>) : [];
}

function uniqueRefPairs(pairs: Array<{ clientIdRef: string; clientSecretRef: string }>) {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.clientIdRef}\n${pair.clientSecretRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function keychainInaccessibleReason(error: MacosKeychainInaccessibleError) {
  return `${error.message}. Unlock Keychain or run from a login session with Keychain access; do not use --without-secrets unless you only need dependency setup.`;
}

function isKeychainInaccessibleReason(reason: string) {
  return /macOS Keychain service .* is inaccessible from this process/.test(reason);
}

export async function isInstallSecretReadinessApplicable(repoRoot = process.cwd()) {
  return Boolean(await discoverInstallSecretReadinessReason(repoRoot));
}

async function discoverInstallSecretReadinessReason(repoRoot: string) {
  if (await pathExists(path.join(repoRoot, PROJECT_SHARED_CONFIG_PATH))) return "project config";
  if ((await discoverDeploymentFamilyMetadataPaths(repoRoot)).length > 0)
    return "deployment metadata";
  if (await pathExists(path.join(repoRoot, "projects", "config")))
    return "project config directory";
  return "";
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

async function pathExists(target: string) {
  try {
    await fsp.access(target);
    return true;
  } catch (error) {
    if (isFileAbsenceError(error)) return false;
    throw error;
  }
}

function bootstrapArgs(flags: SecretReadinessFlags) {
  return [
    "repo",
    "--yes",
    ...valueFlag("machine-label", flags.machineLabel),
    ...valueFlag("login-mode", effectiveLoginMode(flags)),
    ...valueFlag("secret-backend", flags.secretBackend),
    ...valueFlag("infisical-project-name", flags.infisicalProjectName),
    ...boolFlag("select-infisical-project", flags.selectInfisicalProject),
    ...valueFlag("bootstrap-keychain-service-name", flags.bootstrapKeychainServiceName),
    ...valueFlag("keychain-service-name", flags.keychainServiceName),
    ...boolFlag("rotate-bootstrap-credentials", flags.rotateBootstrapCredentials),
    ...boolFlag("rotate-deployment-credentials", flags.rotateDeploymentCredentials),
    ...boolFlag("force-overwrite-local-credentials", flags.forceOverwriteLocalCredentials),
  ];
}

async function selectSecretBackendWhenInteractive(
  opts: {
    flags: SecretReadinessFlags;
    deps?: SecretReadinessDeps;
  },
  interactive: boolean,
  allowed: boolean,
) {
  if (opts.flags.secretBackend.trim() || allowed || !interactive) return;
  const selected = await (opts.deps?.selectSecretBackend || promptSecretBackend)();
  opts.flags.secretBackend = selected;
}

async function promptSecretBackend() {
  return await promptTerminalSelect(
    "Select main secret backend",
    [
      { label: "Infisical", value: "infisical/default" },
      { label: "Vault", value: "vault/default" },
      { label: "macOS Keychain", value: "keychain/default" },
    ],
    0,
    { cancelMessage: "secret backend selection cancelled" },
  );
}

function effectiveLoginMode(flags: SecretReadinessFlags) {
  return flags.infisicalLoginMode.trim() || "browser";
}

function loginModeHint(flags: SecretReadinessFlags) {
  return effectiveLoginMode(flags) === "browser"
    ? "If browser login stalls, press Ctrl-C and rerun with `i --infisical-login-mode interactive`."
    : "Using terminal login fallback because `i --infisical-login-mode interactive` was requested.";
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

async function runLocalReset(
  opts: {
    repoRoot: string;
    deps?: SecretReadinessDeps;
  },
  args: string[],
) {
  return await (
    opts.deps?.resetLocal ||
    ((resetArgs) =>
      runInfisicalBootstrapResetLocal(resetArgs, {
        cwd: opts.repoRoot,
      }))
  )(args);
}

async function runBootstrap(repoRoot: string, args: string[]) {
  try {
    await runNodeWithZx({
      cwd: repoRoot,
      script: buildToolPath(repoRoot, "tools/deployments/infisical-bootstrap.ts"),
      args,
      zxInitPath: zxInitPath(repoRoot),
      stdio: "inherit",
    });
  } catch (error) {
    if (isChildProcessExitError(error)) {
      console.error(
        `BOOTSTRAP FAILED: repo bootstrap exited ${error.exitCode}. See the nearest BOOTSTRAP ERROR block above.`,
      );
      process.exit(error.exitCode);
    }
    throw error;
  }
}

function isChildProcessExitError(error: unknown): error is { exitCode: number } {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    typeof (error as { exitCode?: unknown }).exitCode === "number"
  );
}

function boolFlag(name: string, enabled: boolean) {
  return enabled ? [`--${name}`] : [];
}

function valueFlag(name: string, value: string | undefined) {
  return value?.trim() ? [`--${name}`, value.trim()] : [];
}

function isInteractiveShell() {
  return Boolean((process.stdin.isTTY && process.stderr.isTTY) || hasControllingTerminal());
}

async function promptYesNo(message: string) {
  const streams = promptStreams();
  const rl = readline.createInterface({ input: streams.input, output: streams.output });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
    pausePromptInput(streams.input);
    streams.close();
  }
}

async function promptNoDefault(message: string) {
  const streams = promptStreams();
  const rl = readline.createInterface({ input: streams.input, output: streams.output });
  try {
    const answer = (await rl.question(message)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
    pausePromptInput(streams.input);
    streams.close();
  }
}

type PromptStreams = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  close: () => void;
};

function promptStreams(): PromptStreams {
  if (process.stdin.isTTY) {
    return { input: process.stdin, output: process.stderr, close: () => undefined };
  }
  if (!hasControllingTerminal()) {
    return { input: process.stdin, output: process.stderr, close: () => undefined };
  }
  const input = fs.createReadStream("/dev/tty");
  const output = fs.createWriteStream("/dev/tty");
  return {
    input,
    output,
    close: () => {
      input.destroy();
      output.end();
    },
  };
}

function pausePromptInput(input: NodeJS.ReadableStream) {
  if (typeof input.pause === "function") input.pause();
}

function nonInteractiveMessage() {
  return [
    "Infisical local credentials are not ready.",
    "Rerun `i --yes` to allow local repo bootstrap, or use `i --without-secrets` for dependency-only setup.",
  ].join(" ");
}

function nonInteractiveBootstrapMessage() {
  return [
    "Infisical bootstrap requires confirmation in non-interactive mode.",
    "Rerun with `i --bootstrap --yes`, or run the lower-level reset command first if local bootstrap state must be deleted.",
  ].join(" ");
}
