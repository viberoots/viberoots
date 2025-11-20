#!/usr/bin/env zx-wrapper
import { syncPythonProviders } from "./providers/python.ts";

async function main() {
  await syncPythonProviders({});
  console.log("providers sync complete for python");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
