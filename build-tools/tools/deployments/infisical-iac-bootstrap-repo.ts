import * as path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { defaultDeploymentGraphPath } from "./deployment-graph-read-options";
import {
  withBootstrapCredentialScope,
  withBootstrapKeychainServiceName,
  withRepoInfisicalProjectName,
  withRepoKeychainServiceName,
} from "./infisical-iac-bootstrap-config";
import { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { runDeploymentBootstrapFanOut } from "./infisical-iac-bootstrap-deployments";
import { applyFanOutMetadataHandoff } from "./infisical-iac-bootstrap-metadata-gate";
import { confirmBootstrapPreflight } from "./infisical-iac-bootstrap-preflight";
import { ensureRepoResolverConfig } from "./infisical-iac-bootstrap-resolver";
import { materializeRepoBackendProfiles } from "./infisical-iac-bootstrap-profiles";
import { ensureRepoBootstrapCredential } from "./infisical-iac-bootstrap-repo-credential";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "./infisical-iac-bootstrap-sink";
import { materializeBootstrapCredentialSink } from "./infisical-iac-bootstrap-sink-materialize";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { readSprinkleRefConfig, resolveSprinkleRefBackend } from "./sprinkleref-config";
import { runSprinkleRefCheck } from "./sprinkleref-check";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";
import { validateInfisicalRepoProject } from "./infisical-iac-bootstrap-profile-api";
import { resolveInfisicalAccessToken } from "./deployment-secret-infisical-credentials";
import type { BootstrapArgs, CredentialSink, Identity } from "./infisical-iac-bootstrap-types";
import type {
  DeploymentBootstrapExecutionResult,
  DeploymentBootstrapFanOutResult,
} from "./infisical-iac-bootstrap-deployments";
import type { SharedInfisicalSession } from "./infisical-iac-bootstrap-repo-credential";

export type RepoBootstrapDeps = {
  finalCheckRunner?: (argv: string[]) => Promise<number>;
  repoCredentialFactory?: (
    args: BootstrapArgs,
    opts?: { workspaceRoot?: string; configPath?: string },
  ) => Promise<SharedInfisicalSession>;
  verifyUniversalAuth?: (credential: {
    siteUrl: string;
    clientId: string;
    clientSecret: string;
  }) => Promise<void>;
  credentialSinkFactory?: (
    args: BootstrapArgs,
    opts: { workspaceRoot: string; configPath: string },
  ) => Promise<CredentialSink>;
};

export async function runRepoBootstrap(
  args: BootstrapArgs,
  execute: (
    args: BootstrapArgs,
    context: {
      infisicalSession?: SharedInfisicalSession;
      workspaceRoot?: string;
      configPath?: string;
    },
  ) => Promise<DeploymentBootstrapExecutionResult | void>,
  deps: RepoBootstrapDeps = {},
) {
  const workspaceRoot = await findRepoRoot(process.cwd());
  const scopedArgs = await withRepoKeychainServiceName(
    await withBootstrapKeychainServiceName(
      await withRepoInfisicalProjectName(
        await withBootstrapCredentialScope(args, workspaceRoot),
        workspaceRoot,
      ),
      workspaceRoot,
    ),
    workspaceRoot,
  );
  await confirmBootstrapPreflight(scopedArgs);
  const graphPath = defaultDeploymentGraphPath(workspaceRoot);
  const configPath = path.join(workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH);
  const resolver = await ensureRepoResolverConfig({
    dryRun: false,
    workspaceRoot,
    graphPath,
    configPath,
    secretBackend: scopedArgs.secretBackend,
    keychainServiceName: scopedArgs.keychainServiceName,
    bootstrapKeychainServiceName: scopedArgs.bootstrapKeychainServiceName,
  });
  const sink = await resolveCredentialSinkSelection(scopedArgs, {
    createMissingResolverConfig: true,
    workspaceRoot,
    configPath,
  });
  const credential = (await hasRequiredInfisicalProfile(resolver))
    ? await (deps.repoCredentialFactory || ensureRepoBootstrapCredential)(scopedArgs, {
        workspaceRoot,
        configPath,
      })
    : undefined;
  const materialization = await materializeRepoProfiles(scopedArgs, resolver, credential);
  const credentialSinkMaterialization = await materializeBootstrapCredentialSink({
    args: scopedArgs,
    selection: sink,
    workspaceRoot,
  });
  const verification = await verifyRepoBootstrapState(scopedArgs, resolver, credential, deps);
  console.log(
    JSON.stringify(
      repoReport(
        scopedArgs,
        resolver,
        sink,
        materialization,
        credentialSinkMaterialization,
        credential,
        verification,
      ),
      null,
      2,
    ),
  );
  console.error(`Credential sink: ${sink.description}`);
  printRepoFollowUpCommands(resolver.configPath);
  const fanOut = await runFanOutWithHandoff(
    scopedArgs,
    credential,
    { workspaceRoot, graphPath },
    execute,
  );
  if (fanOut.successes.length > 0) {
    await runFinalSprinkleRefChecks(resolver.configPath, deps.finalCheckRunner);
  }
}

function repoReport(
  args: BootstrapArgs,
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
  sink: Awaited<ReturnType<typeof resolveCredentialSinkSelection>>,
  profileMaterialization: unknown,
  credentialSinkMaterialization: unknown,
  credential?: SharedInfisicalSession,
  verification?: unknown,
) {
  const refs =
    credential?.identity &&
    repoBootstrapCredentialRefs(credential.identity, args.bootstrapCredentialScope);
  return {
    schemaVersion: "infisical-repo-bootstrap-result@1",
    mode: "repo",
    resolverConfig: resolver.configPath,
    profiles: resolver.profiles,
    categories: ["main", "bootstrap"],
    bootstrapCredentialSinks: resolver.bootstrapCredentialProfiles.map((profile) => ({
      profile,
      credentialSink: sink.kind,
      credentialSinkBackend: sink.backend,
      category: sink.category || args.sprinkleCategory || "bootstrap",
    })),
    credentialSink: sink.kind,
    credentialSinkBackend: sink.backend,
    bootstrapCredentialLifecycle:
      credential?.bootstrapCredential && refs
        ? {
            identityName: credential.identity.name,
            clientIdRef: refs.clientIdRef,
            clientSecretRef: refs.clientSecretRef,
            status: credential.bootstrapCredential.status,
            remoteClientSecretRecords: credential.bootstrapCredential.remoteClientSecretRecords,
            remoteClientSecretRecordSummaries:
              credential.bootstrapCredential.remoteClientSecretRecordSummaries,
          }
        : undefined,
    profileMaterialization,
    credentialSinkMaterialization,
    verification,
    deploymentFanOut: { skipped: args.withoutDeployments, optOutFlag: "--without-deployments" },
  };
}

async function verifyRepoBootstrapState(
  args: BootstrapArgs,
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
  credential: SharedInfisicalSession | undefined,
  deps: Pick<RepoBootstrapDeps, "credentialSinkFactory" | "verifyUniversalAuth">,
) {
  const config = await readSprinkleRefConfig(resolver.configPath, resolver.workspaceRoot);
  return {
    bootstrap:
      credential?.bootstrapCredential && credential.identity
        ? await verifyBootstrapCredentials(args, resolver, credential, deps)
        : { status: "not-required" as const },
    main: await verifyMainCredentialBackend(args, resolver, credential, deps, config),
  };
}

async function verifyBootstrapCredentials(
  args: BootstrapArgs,
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
  credential: SharedInfisicalSession,
  deps: Pick<RepoBootstrapDeps, "credentialSinkFactory" | "verifyUniversalAuth">,
) {
  const sink = await createVerificationCredentialSink(args, resolver, deps);
  const refs = repoBootstrapCredentialRefs(credential.identity, args.bootstrapCredentialScope);
  const clientId = await requiredSinkValue(sink, refs.clientIdRef, "bootstrap client id");
  const clientSecret = await requiredSinkValue(
    sink,
    refs.clientSecretRef,
    "bootstrap client secret",
  );
  if (clientId !== credential.bootstrapCredential?.clientId) {
    throw new Error(`bootstrap credential verification failed: ${refs.clientIdRef} mismatch`);
  }
  if (clientSecret !== credential.bootstrapCredential.clientSecret) {
    throw new Error(`bootstrap credential verification failed: ${refs.clientSecretRef} mismatch`);
  }
  await verifyUniversalAuth(deps, {
    siteUrl: args.apiUrl,
    clientId,
    clientSecret,
  });
  return {
    status: "verified" as const,
    clientIdRef: refs.clientIdRef,
    clientSecretRef: refs.clientSecretRef,
    auth: "verified" as const,
  };
}

async function verifyMainCredentialBackend(
  args: BootstrapArgs,
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
  credential: SharedInfisicalSession | undefined,
  deps: Pick<RepoBootstrapDeps, "credentialSinkFactory" | "verifyUniversalAuth">,
  config: Awaited<ReturnType<typeof readSprinkleRefConfig>>,
) {
  const resolved = resolveSprinkleRefBackend(config, config.defaultCategory || "main");
  if (resolved.backend.backend !== "infisical") {
    return {
      status: "not-authenticated" as const,
      category: resolved.category,
      backend: resolved.backend.backend,
      reason: "backend has no Infisical auth probe",
    };
  }
  if (!credential) throw new Error("main Infisical credential verification needs repo session");
  const projectId = resolved.backend.projectId || envValue(resolved.backend.projectIdEnv);
  if (!projectId) throw new Error("main Infisical credential verification missing project id");
  await validateInfisicalRepoProject(credential.api, credential.organizationId, projectId, {
    requireOrganizationEvidence: false,
  });
  const sink = await createVerificationCredentialSink(args, resolver, deps);
  const clientId = await credentialValue(
    sink,
    resolved.backend.clientIdEnv,
    resolved.backend.clientIdRef,
    "main Infisical client id",
  );
  const clientSecret = await credentialValue(
    sink,
    resolved.backend.clientSecretEnv,
    resolved.backend.clientSecretRef,
    "main Infisical client secret",
  );
  await verifyUniversalAuth(deps, {
    siteUrl: resolved.backend.host || args.apiUrl,
    clientId,
    clientSecret,
  });
  return {
    status: "verified" as const,
    category: resolved.category,
    profile: resolved.profile,
    backend: "infisical" as const,
    projectId,
    auth: "verified" as const,
  };
}

async function credentialValue(
  sink: Awaited<ReturnType<typeof createCredentialSink>>,
  envName: string | undefined,
  ref: string | undefined,
  label: string,
) {
  const fromEnv = envValue(envName);
  if (fromEnv) return fromEnv;
  if (!ref) throw new Error(`${label} is not configured`);
  return await requiredSinkValue(sink, ref, label);
}

async function requiredSinkValue(
  sink: Awaited<ReturnType<typeof createCredentialSink>>,
  ref: string,
  label: string,
) {
  const value = (await sink.read(ref))?.trim();
  if (!value) throw new Error(`bootstrap verification failed: missing ${label} at ${ref}`);
  return value;
}

async function createVerificationCredentialSink(
  args: BootstrapArgs,
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
  deps: Pick<RepoBootstrapDeps, "credentialSinkFactory">,
) {
  const opts = { workspaceRoot: resolver.workspaceRoot, configPath: resolver.configPath };
  return await (deps.credentialSinkFactory || createCredentialSink)(args, opts);
}

function envValue(name?: string) {
  return name ? String(process.env[name] || "").trim() : "";
}

async function verifyUniversalAuth(
  deps: Pick<RepoBootstrapDeps, "verifyUniversalAuth">,
  credential: { siteUrl: string; clientId: string; clientSecret: string },
) {
  if (deps.verifyUniversalAuth) return await deps.verifyUniversalAuth(credential);
  await resolveInfisicalAccessToken({ kind: "universal_auth", ...credential });
}

async function runFanOutWithHandoff(
  args: BootstrapArgs,
  credential: SharedInfisicalSession | undefined,
  context: { workspaceRoot: string; graphPath: string },
  execute: (
    args: BootstrapArgs,
    context: { infisicalSession?: SharedInfisicalSession },
  ) => Promise<DeploymentBootstrapExecutionResult | void>,
): Promise<DeploymentBootstrapFanOutResult> {
  const run = () => runFanOut(args, credential, context, execute);
  const fanOut = await run();
  if ((await applyFanOutMetadataHandoff(args, fanOut)).status === "applied") return await run();
  return fanOut;
}

async function runFanOut(
  args: BootstrapArgs,
  credential: SharedInfisicalSession | undefined,
  context: { workspaceRoot: string; graphPath: string },
  execute: (
    args: BootstrapArgs,
    context: { infisicalSession?: SharedInfisicalSession },
  ) => Promise<DeploymentBootstrapExecutionResult | void>,
): Promise<DeploymentBootstrapFanOutResult> {
  return await runDeploymentBootstrapFanOut({
    args,
    workspaceRoot: context.workspaceRoot,
    graphPath: context.graphPath,
    execute: async (deploymentArgs) =>
      execute(deploymentArgs, {
        ...(credential ? { infisicalSession: credential } : {}),
        workspaceRoot: context.workspaceRoot,
        configPath: path.join(context.workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH),
      }),
  });
}

async function materializeRepoProfiles(
  args: BootstrapArgs,
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
  credential?: { api: InfisicalApi; organizationId: string; identity: Identity },
) {
  if (!(await hasRequiredInfisicalProfile(resolver))) {
    return await materializeRepoBackendProfiles({
      args,
      configPath: resolver.configPath,
      workspaceRoot: resolver.workspaceRoot,
      requiredProfiles: resolver.profiles,
    });
  }
  if (!credential) throw new Error("Infisical bootstrap credential was not prepared");
  return await materializeRepoBackendProfiles({
    args,
    api: credential.api,
    organizationId: credential.organizationId,
    identity: credential.identity,
    configPath: resolver.configPath,
    workspaceRoot: resolver.workspaceRoot,
    requiredProfiles: resolver.profiles,
  });
}

async function hasRequiredInfisicalProfile(
  resolver: Awaited<ReturnType<typeof ensureRepoResolverConfig>>,
) {
  const config = await readSprinkleRefConfig(resolver.configPath, resolver.workspaceRoot);
  return resolver.profiles.some((profile) => {
    const backend = config.profiles[profile];
    return profile.startsWith("infisical-") || backend?.backend === "infisical";
  });
}

function printRepoFollowUpCommands(configPath: string) {
  console.error("Next checks:");
  console.error(`  sprinkleref --check --config ${configPath}`);
  console.error(`  sprinkleref --check --category bootstrap --config ${configPath}`);
}

async function runFinalSprinkleRefChecks(
  configPath: string,
  runner: (argv: string[]) => Promise<number> = defaultFinalCheckRunner,
) {
  const commands = [
    ["--check", "--config", configPath],
    ["--check", "--category", "bootstrap", "--config", configPath],
  ];
  for (const argv of commands) {
    const printable = `sprinkleref ${argv.join(" ")}`;
    console.error(`Running final check: ${printable}`);
    const code = await runner(argv);
    if (code !== 0) throw new Error(`Final SprinkleRef check failed: ${printable}`);
  }
}

async function defaultFinalCheckRunner(argv: string[]) {
  return await runSprinkleRefCheck({ argv });
}
