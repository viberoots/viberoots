#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { parseBootstrapArgs, usage } from "./infisical-iac-bootstrap-args";
import { getArgvTokens } from "../lib/argv";
import { findRepoRoot } from "../lib/repo";
import {
  deploymentScopeFromTarget,
  resolveInfisicalHost,
  withBootstrapCredentialScope,
  withBootstrapKeychainServiceName,
  withDeploymentBootstrapDefaults,
  withRepoInfisicalProjectName,
  withRepoKeychainServiceName,
} from "./infisical-iac-bootstrap-config";
import { spawnCommandRunner } from "./infisical-iac-bootstrap-auth";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "./infisical-iac-bootstrap-sink";
import { ensureBootstrapCredential, ensureUniversalAuth } from "./infisical-iac-bootstrap-identity";
import {
  createInfisicalSession,
  type SharedInfisicalSession,
} from "./infisical-iac-bootstrap-repo-credential";
import { buildCredentialHandoffReport } from "./infisical-iac-bootstrap-handoff";
import { buildDryRunGuidance, buildDryRunReport } from "./infisical-iac-bootstrap-dry-run";
import { runRepoBootstrap } from "./infisical-iac-bootstrap-repo";
import { readDeploymentRuntimeMetadata, runOpenTofu } from "./infisical-iac-bootstrap-tofu";
import { confirmBootstrapPreflight } from "./infisical-iac-bootstrap-preflight";
import { reconcileDeploymentMetadata } from "./infisical-iac-bootstrap-reconcile";
import { ensureDeploymentCredentials } from "./infisical-iac-deployment-credentials";
import {
  readDeploymentReviewedMetadata,
  readDeploymentReviewedMetadataSource,
} from "./infisical-iac-bootstrap-reviewed-metadata";
import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

export async function runInfisicalIacBootstrap(
  args: BootstrapArgs,
  context: {
    infisicalSession?: SharedInfisicalSession;
    workspaceRoot?: string;
    configPath?: string;
  } = {},
) {
  const workspaceRoot = context.workspaceRoot || (await findRepoRoot(process.cwd()));
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
  const scopedContext = { ...context, workspaceRoot };
  if (scopedArgs.mode === "repo") {
    if (scopedArgs.dryRun) return dryRun(scopedArgs, scopedContext);
    return await runRepoBootstrap(scopedArgs, runInfisicalIacBootstrap);
  }
  const deploymentArgs = withDeploymentBootstrapDefaults(scopedArgs);
  const scope = deploymentScopeFromTarget(deploymentArgs);
  const configPath =
    context.configPath || path.join(workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH);
  const rootContext = { ...scopedContext, configPath };
  const reviewedSource = await readDeploymentReviewedMetadataSource(
    scope,
    undefined,
    workspaceRoot,
  );
  const reviewedMetadata = await readDeploymentReviewedMetadata(scope, undefined, workspaceRoot);
  const effectiveArgs = withReviewedHost(deploymentArgs, reviewedMetadata.siteUrl);
  if (effectiveArgs.dryRun) return dryRun(effectiveArgs, rootContext);
  await confirmBootstrapPreflight(effectiveArgs);
  const sinkSelection = await resolveCredentialSinkSelection(effectiveArgs, {
    createMissingResolverConfig: true,
    workspaceRoot,
    configPath,
  });
  const session =
    context.infisicalSession?.apiUrl === effectiveArgs.apiUrl
      ? context.infisicalSession
      : await createInfisicalSession(effectiveArgs);
  const api = session.api;
  const resolvedArgs = { ...effectiveArgs, organizationId: session.organizationId };
  const identity = session.identity;
  await ensureUniversalAuth(api, resolvedArgs, identity);
  const sink = await createCredentialSink(effectiveArgs, {
    workspaceRoot,
    configPath,
  });
  const credential =
    session.bootstrapCredential ??
    (await ensureBootstrapCredential({ api, args: resolvedArgs, identity, sink }));
  const tofu = await runOpenTofu({
    args: resolvedArgs,
    credential,
    reviewedMetadata,
    api,
    bootstrapIdentity: identity,
    runner: spawnCommandRunner,
  });
  if (scopedArgs.noTofuApply) {
    console.log(
      JSON.stringify(
        { schemaVersion: "infisical-iac-bootstrap-preview@1", savedPlan: tofu.savedPlan },
        null,
        2,
      ),
    );
    return;
  }
  const metadata = readDeploymentRuntimeMetadata(resolvedArgs, spawnCommandRunner);
  const reconciliation = reconcileDeploymentMetadata(metadata, reviewedMetadata, reviewedSource, {
    allowReviewedIdHandoff: Boolean(tofu.adoption.projectId),
    scope,
  });
  if (reconciliation.status === "metadata_handoff_required") {
    const result = { reconciliation, deploymentCredentialLifecycle: [], credentialHandoff: null };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const deploymentCredentialLifecycle = await ensureDeploymentCredentials({
    api,
    args: effectiveArgs,
    sink,
    metadata,
  });
  const result = {
    reconciliation,
    deploymentCredentialLifecycle,
    credentialHandoff: buildCredentialHandoffReport({
      args: effectiveArgs,
      sinkSelection,
      sinkDescription: sink.describe(),
      bootstrapIdentity: identity,
      metadata: reviewedMetadata,
    }),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function dryRun(
  args: BootstrapArgs,
  context: { workspaceRoot?: string; configPath?: string } = {},
) {
  console.log(JSON.stringify(await buildDryRunReport(args, context), null, 2));
  for (const line of await buildDryRunGuidance(args, context)) console.error(line);
  if (args.mode === "repo") {
    printRepoFollowUpCommands(DEFAULT_SPRINKLEREF_CONFIG_PATH);
  }
}

function printRepoFollowUpCommands(configPath: string) {
  console.error("Next checks:");
  console.error(`  sprinkleref --check --config ${configPath}`);
  console.error(`  sprinkleref --check --category bootstrap --config ${configPath}`);
}

function withReviewedHost(args: BootstrapArgs, siteUrl: string): BootstrapArgs {
  if (args.hostOverride) return args;
  return { ...args, ...resolveInfisicalHost(siteUrl) };
}

export async function runInfisicalBootstrapMain(
  opts: {
    argv?: string[];
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
    exit?: (code: number) => void;
  } = {},
) {
  const argv = opts.argv || getArgvTokens();
  const stdout = opts.stdout || console.log;
  const stderr = opts.stderr || console.error;
  const exit = opts.exit || process.exit;
  if (argv.includes("--help") || argv.includes("-h")) {
    stdout(usage());
    return;
  }
  const args = parseBootstrapArgs(argv);
  await runInfisicalIacBootstrap(args).catch((error: unknown) => {
    stderr(errorMessage(error, [process.env[args.accessTokenEnv]]));
    exit(1);
  });
}

if (isMainModule()) await runInfisicalBootstrapMain();

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
