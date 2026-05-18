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
import { buildDryRunReport } from "./infisical-iac-bootstrap-dry-run";
import { resolveOrganizationId } from "./infisical-iac-bootstrap-org";
import { readDeploymentRuntimeMetadata, runOpenTofu } from "./infisical-iac-bootstrap-tofu";
import { assertBootstrapPreflight } from "./infisical-iac-bootstrap-preflight";
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
  assertBootstrapPreflight(effectiveArgs);
  const access = await getAccessToken(effectiveArgs);
  const api = new InfisicalApi({ apiUrl: effectiveArgs.apiUrl, token: access.token });
  const organizationId = await resolveOrganizationId(api, effectiveArgs);
  const resolvedArgs = { ...effectiveArgs, organizationId };
  const identity = await ensureIdentity(api, resolvedArgs);
  await ensureUniversalAuth(api, resolvedArgs, identity);
  const sinkSelection = await resolveCredentialSinkSelection(effectiveArgs);
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
  assertBootstrapPreflight(args);
  const resolver = await ensureRepoResolverConfig({ dryRun: false });
  const sink = await resolveCredentialSinkSelection(args, { createMissingResolverConfig: true });
  console.log(
    JSON.stringify(
      {
        schemaVersion: "infisical-repo-bootstrap-result@1",
        resolverConfig: resolver.configPath,
        profiles: resolver.profiles,
        categories: ["main", "bootstrap"],
        bootstrapCredentialSinks: resolver.bootstrapCredentialProfiles.map((profile) => ({
          profile,
          credentialSink: sink.kind,
          credentialSinkBackend: sink.backend,
          category: sink.category || args.sprinkleCategory || "bootstrap",
        })),
        nextCommands: [`sprinkleref --check --config ${resolver.configPath}`],
        credentialSink: sink.kind,
        credentialSinkBackend: sink.backend,
      },
      null,
      2,
    ),
  );
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
}

function withReviewedHost(args: BootstrapArgs, siteUrl: string): BootstrapArgs {
  if (args.hostOverride) return args;
  return { ...args, ...resolveInfisicalHost(siteUrl) };
}

if (isMainModule()) {
  const args = parseBootstrapArgs();
  const argv = getArgvTokens();
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }
  await runInfisicalIacBootstrap(args).catch((error: unknown) => {
    console.error(errorMessage(error, [process.env[args.accessTokenEnv]]));
    process.exit(1);
  });
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
