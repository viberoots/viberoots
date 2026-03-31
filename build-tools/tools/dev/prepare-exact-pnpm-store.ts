#!/usr/bin/env zx-wrapper
import path from "node:path";
import { prepareExactPnpmStore } from "./update-pnpm-hash/lockfile.ts";

function parseImporterArg(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--importer") {
      const value = String(args[i + 1] || "").trim();
      if (!value) break;
      return value;
    }
  }
  throw new Error("usage: prepare-exact-pnpm-store.ts --importer <importer-relpath>");
}

async function main() {
  const importer = parseImporterArg();
  const repoRoot = process.cwd();
  const prepared = await prepareExactPnpmStore({ repoRoot, importer });
  process.stdout.write(path.resolve(prepared.exactStorePath) + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
