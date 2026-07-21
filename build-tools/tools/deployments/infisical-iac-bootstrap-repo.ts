import * as path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { defaultDeploymentGraphPath } from "./deployment-graph-read-options";
import {
  withBootstrapCredentialScope,
  withBootstrapKeychainServiceName,
  withRepoInfisicalProjectName,
  withRepoKeychainServiceName,
} from "./infisical-iac-bootstrap-config";
import { confirmBootstrapPreflight } from "./infisical-iac-bootstrap-preflight";
import { ensureRepoResolverConfig } from "./infisical-iac-bootstrap-resolver";
import { ensureRepoBootstrapCredential } from "./infisical-iac-bootstrap-repo-credential";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { materializeBootstrapCredentialSink } from "./infisical-iac-bootstrap-sink-materialize";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { runSprinkleRefCheck } from "./sprinkleref-check";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";
import type { BootstrapArgs, CredentialSink } from "./infisical-iac-bootstrap-types";
import type { DeploymentBootstrapExecutionResult } from "./infisical-iac-bootstrap-deployments";
import type { SharedInfisicalSession } from "./infisical-iac-bootstrap-repo-credential";
import { verifyRepoBootstrapState } from "./infisical-iac-bootstrap-repo-verification";
import {
  hasRequiredInfisicalProfile,
  materializeRepoProfiles,
  runFanOutWithHandoff,
} from "./infisical-iac-bootstrap-repo-execution";

type RepoBootstrapIo = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  question?: (prompt: string) => Promise<string>;
};

export type RepoBootstrapDeps = {
  finalCheckRunner?: (argv: string[]) => Promise<number>;
  io?: RepoBootstrapIo;
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
  await confirmBootstrapPreflight(scopedArgs, deps.io);
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
    deps.io,
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
