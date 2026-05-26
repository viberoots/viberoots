#!/usr/bin/env zx-wrapper
import { scanRepositoryRefs } from "./sprinkleref-check-scan";
import { collectAllDeploymentRefs, collectTargetRefs } from "./sprinkleref-check-target";
import type {
  SprinkleRefCheckEntry,
  SprinkleRefDepsMode,
  SprinkleRefScheme,
} from "./sprinkleref-check-types";

export async function collectCheckRefs(opts: {
  target?: string;
  deps: SprinkleRefDepsMode;
  env?: NodeJS.ProcessEnv;
  usageError: (message: string) => never;
}) {
  return opts.target
    ? await targetRefs(opts.target, opts.deps, opts.env, opts.usageError)
    : await repoRefs(opts.usageError);
}

async function repoRefs(usageError: (message: string) => never) {
  const scanned = await scanRepositoryRefs().catch((error: unknown) =>
    usageError(error instanceof Error ? error.message : String(error)),
  );
  const structured = await collectAllDeploymentRefs().catch(() => []);
  const scannedRefs = new Set(scanned.refs.map((entry) => entry.ref));
  const relevantStructured = structured.filter((entry) => scannedRefs.has(entry.ref));
  const structuredRefs = new Set(relevantStructured.map((entry) => entry.ref));
  return {
    scannedFiles: scanned.scannedFiles,
    refs: [
      ...scanned.refs
        .filter((entry) => !structuredRefs.has(entry.ref))
        .map((entry) => ({
          ref: entry.ref,
          scheme: entry.scheme,
          scope: "repo" as const,
          locations: entry.locations.map((loc) => `${loc.file}:${loc.line}`),
          requiredBy: [],
        })),
      ...relevantStructured.map((entry) => entryToCheckRef(entry, "repo")),
    ],
  };
}

async function targetRefs(
  target: string,
  deps: SprinkleRefDepsMode,
  env: NodeJS.ProcessEnv | undefined,
  usageError: (message: string) => never,
) {
  const refs = await collectTargetRefs({ target, deps, env }).catch((error: unknown) =>
    usageError(error instanceof Error ? error.message : String(error)),
  );
  return {
    scannedFiles: 0,
    refs: refs.map((entry) => entryToCheckRef(entry, entry.scope)),
  };
}

function entryToCheckRef(
  entry: Awaited<ReturnType<typeof collectTargetRefs>>[number],
  scope: SprinkleRefCheckEntry["scope"],
) {
  return {
    ref: entry.ref,
    scheme: schemeOf(entry.ref),
    scope,
    locations: entry.locations,
    requiredBy: [entry.requiredBy],
    source: entry.source,
    backendEnvironment: entry.backendEnvironment,
    backendHost: entry.backendHost,
    backendProjectId: entry.backendProjectId,
    backendProjectName: entry.backendProjectName,
    backendSecretPath: entry.backendSecretPath,
    deploymentFamily: entry.deploymentFamily,
  };
}

function schemeOf(ref: string): SprinkleRefScheme {
  return ref.slice(0, ref.indexOf("://")) as SprinkleRefScheme;
}
