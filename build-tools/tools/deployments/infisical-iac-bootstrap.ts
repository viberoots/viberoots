#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import { parseBootstrapArgs, usage } from "./infisical-iac-bootstrap-args";
import { getArgvTokens } from "../lib/argv";
import { resolveInfisicalHost } from "./infisical-iac-bootstrap-config";
import { InfisicalApi } from "./infisical-iac-bootstrap-api";
import { getAccessToken, spawnCommandRunner } from "./infisical-iac-bootstrap-auth";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "./infisical-iac-bootstrap-sink";
import {
  ensureBootstrapCredential,
  ensureIdentity,
  ensureUniversalAuth,
} from "./infisical-iac-bootstrap-identity";
import { buildCredentialHandoffReport } from "./infisical-iac-bootstrap-handoff";
import { buildDryRunGuidance, buildDryRunReport } from "./infisical-iac-bootstrap-dry-run";
import { resolveOrganizationId } from "./infisical-iac-bootstrap-org";
import { readDeploymentRuntimeMetadata, runOpenTofu } from "./infisical-iac-bootstrap-tofu";
import { confirmBootstrapPreflight } from "./infisical-iac-bootstrap-preflight";
import { reconcileDeploymentMetadata } from "./infisical-iac-bootstrap-reconcile";
import { ensureDeploymentCredentials } from "./infisical-iac-deployment-credentials";
import { readPleominoReviewedMetadata } from "./infisical-iac-bootstrap-reviewed-metadata";
import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import { ensureRepoResolverConfig } from "./infisical-iac-bootstrap-resolver";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

const PLEOMINO_DEPLOYMENT_BOOTSTRAP_TARGETS = new Set([
  "//projects/deployments/pleomino-staging:deploy",
  "//projects/deployments/pleomino-prod:deploy",
]);

export async function runInfisicalIacBootstrap(args: BootstrapArgs) {
  if (args.mode === "repo") return await runRepoBootstrap(args);
  const scope = deploymentScopeFromTarget(args);
  if (scope.kind !== "pleomino") {
    throw new Error(`unsupported deployment bootstrap scope: ${args.target || "<missing>"}`);
  }
  const reviewedMetadata = await readPleominoReviewedMetadata();
  const effectiveArgs = withReviewedHost(args, reviewedMetadata.siteUrl);
  if (effectiveArgs.dryRun) return dryRun(effectiveArgs);
  await confirmBootstrapPreflight(effectiveArgs);
  const sinkSelection = await resolveCredentialSinkSelection(effectiveArgs, {
    createMissingResolverConfig: true,
  });
  const access = await getAccessToken(effectiveArgs);
  const api = new InfisicalApi({ apiUrl: effectiveArgs.apiUrl, token: access.token });
  const organizationId = await resolveOrganizationId(api, effectiveArgs);
  const resolvedArgs = { ...effectiveArgs, organizationId };
  const identity = await ensureIdentity(api, resolvedArgs);
  await ensureUniversalAuth(api, resolvedArgs, identity);
  const sink = await createCredentialSink(effectiveArgs);
  const credential = await ensureBootstrapCredential({
    api,
    args: resolvedArgs,
    identity,
    sink,
  });
  const tofu = await runOpenTofu({
    args: resolvedArgs,
    credential,
    reviewedMetadata,
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
  const reconciliation = reconcileDeploymentMetadata(metadata, reviewedMetadata);
  const deploymentCredentialLifecycle = await ensureDeploymentCredentials({
    api,
    args: effectiveArgs,
    sink,
    metadata,
  });
  if (access.cleanupMessage) console.error(access.cleanupMessage);
  console.log(
    JSON.stringify(
      {
        reconciliation,
        deploymentCredentialLifecycle,
        credentialHandoff: buildCredentialHandoffReport({
          args: effectiveArgs,
          sinkSelection,
          sinkDescription: sink.describe(),
          bootstrapIdentity: identity,
          metadata: reviewedMetadata,
        }),
      },
      null,
      2,
    ),
  );
}

async function runRepoBootstrap(args: BootstrapArgs) {
  if (args.dryRun) return dryRun(args);
  await confirmBootstrapPreflight(args);
  const resolver = await ensureRepoResolverConfig({ dryRun: false });
  const sink = await resolveCredentialSinkSelection(args, { createMissingResolverConfig: true });
  console.log(
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
  console.error(`Credential sink: ${sink.description}`);
  printRepoFollowUpCommands(resolver.configPath);
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
