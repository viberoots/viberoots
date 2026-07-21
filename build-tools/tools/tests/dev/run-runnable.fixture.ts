#!/usr/bin/env zx-wrapper
import { getArgvTokens } from "../../lib/cli";
import { enterRunnableEntrypoint, runRunnable } from "../../dev/run-runnable";
import { readManifestEntry } from "../../dev/run-runnable-core";

const fixturePrefix = "--fixture-manifest=";
const authority = await enterRunnableEntrypoint();
const argv = getArgvTokens();
const fixtureArg = argv.find((value) => value.startsWith(fixturePrefix));
const manifestPath = String(fixtureArg || "").slice(fixturePrefix.length);
if (!manifestPath) throw new Error("run-runnable fixture requires --fixture-manifest=<path>");

await runRunnable({
  ...authority,
  argv: argv.filter((value) => value !== fixtureArg),
  resolveEntry: async (target) => await readManifestEntry(manifestPath, target),
});
