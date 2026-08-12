#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { getArgvTokens } from "../../lib/cli";
import { enterRunnableEntrypoint, runRunnable } from "../../dev/run-runnable";
import { readManifestEntry } from "../../dev/run-runnable-core";

const fixturePrefix = "--fixture-manifest=";
const commandLogPrefix = "--fixture-command-log=";
const authority = await enterRunnableEntrypoint();
const argv = getArgvTokens();
const fixtureArg = argv.find((value) => value.startsWith(fixturePrefix));
const commandLogArg = argv.find((value) => value.startsWith(commandLogPrefix));
const manifestPath = String(fixtureArg || "").slice(fixturePrefix.length);
const commandLogPath = String(commandLogArg || "").slice(commandLogPrefix.length);
if (!manifestPath) throw new Error("run-runnable fixture requires --fixture-manifest=<path>");

await runRunnable({
  ...authority,
  argv: argv.filter((value) => value !== fixtureArg && value !== commandLogArg),
  resolveEntry: async (target) => await readManifestEntry(manifestPath, target),
  ...(commandLogPath
    ? {
        executeCommand: async (command: string[], extra: string[], cwd?: string) => {
          await fsp.writeFile(
            commandLogPath,
            JSON.stringify({ argv: [...command, ...extra], cwd: cwd || process.cwd() }) + "\n",
          );
          return 0;
        },
      }
    : {}),
});
