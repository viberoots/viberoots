#!/usr/bin/env zx-wrapper
import { pathToFileURL } from "node:url";
import { discoverProjectEnforcementRunners } from "./build-tools/tools/lib/project-enforcement-registration";

const target = String(process.env.BUCK_TEST_TARGET || "")
  .replace(/ \([^)]*\)$/, "")
  .split(":")
  .at(-1);
const viberootsRoot = process.env.VIBEROOTS_ROOT;
if (!target || !viberootsRoot) {
  throw new Error("project enforcement runner requires BUCK_TEST_TARGET and VIBEROOTS_ROOT");
}

const runners = await discoverProjectEnforcementRunners(viberootsRoot);
const runner = runners.find((candidate) => candidate.name === target);
if (!runner) {
  throw new Error(`project enforcement runner is not registered: ${target}`);
}
await import(pathToFileURL(runner.sourcePath).href);
