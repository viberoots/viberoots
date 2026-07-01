import * as path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { defaultDeploymentGraphPath } from "./deployment-graph-read-options";
import { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { runDeploymentBootstrapFanOut } from "./infisical-iac-bootstrap-deployments";
import { applyFanOutMetadataHandoff } from "./infisical-iac-bootstrap-metadata-gate";
import { confirmBootstrapPreflight } from "./infisical-iac-bootstrap-preflight";
import { ensureRepoResolverConfig } from "./infisical-iac-bootstrap-resolver";
import { materializeRepoBackendProfiles } from "./infisical-iac-bootstrap-profiles";
import { ensureRepoBootstrapCredential } from "./infisical-iac-bootstrap-repo-credential";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { materializeBootstrapCredentialSink } from "./infisical-iac-bootstrap-sink-materialize";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { runSprinkleRefCheck } from "./sprinkleref-check";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";
import type { BootstrapArgs, Identity } from "./infisical-iac-bootstrap-types";
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
  await confirmBootstrapPreflight(args);
  const workspaceRoot = await findRepoRoot(process.cwd());
  const graphPath = defaultDeploymentGraphPath(workspaceRoot);
  const configPath = path.join(workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH);
  const resolver = await ensureRepoResolverConfig({
    dryRun: false,
    workspaceRoot,
    graphPath,
    configPath,
  });
  const sink = await resolveCredentialSinkSelection(args, {
    createMissingResolverConfig: true,
    workspaceRoot,
    configPath,
  });
  const credential = (await hasRequiredInfisicalProfile(resolver))
    ? await (deps.repoCredentialFactory || ensureRepoBootstrapCredential)(args, {
        workspaceRoot,
        configPath,
      })
    : undefined;
  const materialization = await materializeRepoProfiles(args, resolver, credential);
  const credentialSinkMaterialization = await materializeBootstrapCredentialSink({
    args,
    selection: sink,
    workspaceRoot,
  });
  console.log(
    JSON.stringify(
      repoReport(args, resolver, sink, materialization, credentialSinkMaterialization, credential),
      null,
      2,
    ),
  );
  console.error(`Credential sink: ${sink.description}`);
  printRepoFollowUpCommands(resolver.configPath);
  const fanOut = await runFanOutWithHandoff(
    args,
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
) {
  const refs = credential?.identity && repoBootstrapCredentialRefs(credential.identity);
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
    deploymentFanOut: { skipped: args.withoutDeployments, optOutFlag: "--without-deployments" },
  };
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
