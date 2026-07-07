#!/usr/bin/env zx-wrapper
import path from "node:path";
import { readImporterArg } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import { prepareExactPnpmStore } from "./update-pnpm-hash/lockfile";

function parseImporterArg(): string {
  const value = readImporterArg("").trim();
  if (value) return value;
  throw new Error("usage: prepare-exact-pnpm-store.ts --importer <importer-relpath>");
}

async function main() {
  const importer = parseImporterArg();
  const repoRoot = await findRepoRoot(process.cwd());
  const prepared = await prepareExactPnpmStore({ repoRoot, importer });
  process.stdout.write(path.resolve(prepared.exactStorePath) + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
