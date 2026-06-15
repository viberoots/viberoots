#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getFlagBool, getFlagStr } from "../lib/cli";

const requiredWorkerBins = [
  "bash",
  "ls",
  "find",
  "grep",
  "sed",
  "awk",
  "git",
  "node",
  "pnpm",
  "buck2",
  "zx-wrapper",
  "timeout",
];

async function verifyWorkerBins(toolsPath: string): Promise<void> {
  for (const bin of requiredWorkerBins) {
    try {
      await fs.access(path.join(toolsPath, "bin", bin));
    } catch {
      console.error(`missing required worker tool: ${bin}`);
      process.exitCode = 1;
      return;
    }
  }
}

function isNixStorePath(toolsPath: string): boolean {
  return toolsPath.startsWith("/nix/store/");
}

export async function main(): Promise<void> {
  const toolsPath = getFlagStr("remote-worker-tools");
  if (!toolsPath) {
    console.error("remote-worker-bootstrap: missing --remote-worker-tools");
    process.exitCode = 1;
    return;
  }
  if (!isNixStorePath(toolsPath)) {
    console.error("remote-worker-bootstrap: --remote-worker-tools must be a Nix store path");
    process.exitCode = 1;
    return;
  }

  const restrictedPath = path.join(toolsPath, "bin");
  process.env.PATH = restrictedPath;

  console.log(`remote-worker-tools=${toolsPath}`);
  console.log(`PATH=${restrictedPath}`);

  await verifyWorkerBins(toolsPath);
  if (process.exitCode) return;

  if (getFlagBool("check-only")) {
    console.log("remote-worker-bootstrap: local checks passed; scheduler registration is disabled");
    return;
  }

  console.log("remote-worker-bootstrap: no scheduler registration is implemented");
}

async function isEntrypoint(): Promise<boolean> {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  if (import.meta.url === pathToFileURL(argvPath).href) return true;
  try {
    return import.meta.url === pathToFileURL(await fs.realpath(argvPath)).href;
  } catch {
    return false;
  }
}

if (await isEntrypoint()) await main();
