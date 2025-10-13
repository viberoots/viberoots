#!/usr/bin/env zx-wrapper
// tools/buck/sync-providers-node.ts — delegate to orchestrator's node driver (back-compat)
import { syncNodeProviders } from "./providers/node";

async function main() {
  await syncNodeProviders({});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
