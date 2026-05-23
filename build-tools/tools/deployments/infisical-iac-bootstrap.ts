#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import { parseBootstrapArgs, usage } from "./infisical-iac-bootstrap-args";
import { getArgvTokens } from "../lib/argv";
import {
  resolveInfisicalHost,
  withDeploymentBootstrapDefaults,
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
  readPleominoReviewedMetadata,
  readPleominoReviewedMetadataSource,
} from "./infisical-iac-bootstrap-reviewed-metadata";
import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

const PLEOMINO_DEPLOYMENT_BOOTSTRAP_TARGETS = new Set([
  "//projects/deployments/pleomino/staging:deploy",
  "//projects/deployments/pleomino/prod:deploy",
]);

export async function runInfisicalIacBootstrap(
  args: BootstrapArgs,
  context: { infisicalSession?: SharedInfisicalSession } = {},
) {
  if (args.mode === "repo") {
    if (args.dryRun) return dryRun(args);
    return await runRepoBootstrap(args, runInfisicalIacBootstrap);
  }
  const deploymentArgs = withDeploymentBootstrapDefaults(args);
  deploymentScopeFromTarget(deploymentArgs);
  const reviewedSource = await readPleominoReviewedMetadataSource();
  const reviewedMetadata = await readPleominoReviewedMetadata();
  const effectiveArgs = withReviewedHost(deploymentArgs, reviewedMetadata.siteUrl);
  if (effectiveArgs.dryRun) return dryRun(effectiveArgs);
  await confirmBootstrapPreflight(effectiveArgs);
  const sinkSelection = await resolveCredentialSinkSelection(effectiveArgs, {
    createMissingResolverConfig: true,
  });
  const session =
    context.infisicalSession?.apiUrl === effectiveArgs.apiUrl
      ? context.infisicalSession
      : await createInfisicalSession(effectiveArgs);
  const api = session.api;
  const resolvedArgs = { ...effectiveArgs, organizationId: session.organizationId };
  const identity = session.identity;
  await ensureUniversalAuth(api, resolvedArgs, identity);
  const sink = await createCredentialSink(effectiveArgs);
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
  if (args.noTofuApply) {
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
  const reconciliation = reconcileDeploymentMetadata(metadata, reviewedMetadata, reviewedSource);
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

function deploymentScopeFromTarget(args: BootstrapArgs) {
  if (!args.target) throw new Error("deployment bootstrap requires --target <buck-target>");
  if (!PLEOMINO_DEPLOYMENT_BOOTSTRAP_TARGETS.has(args.target)) {
    throw new Error(
      `deployment bootstrap target ${args.target} is not supported; supported targets: ${[
        ...PLEOMINO_DEPLOYMENT_BOOTSTRAP_TARGETS,
      ].join(", ")}`,
    );
  }
  return { kind: "pleomino" as const, target: args.target };
}

async function dryRun(args: BootstrapArgs) {
  console.log(JSON.stringify(await buildDryRunReport(args), null, 2));
  for (const line of await buildDryRunGuidance(args)) console.error(line);
  if (args.mode === "repo") {
    printRepoFollowUpCommands("sprinkleref/selected.local.json");
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
