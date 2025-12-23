#!/usr/bin/env zx-wrapper
import { readCompositeGraph } from "../lib/graph-view.ts";
import { getFlagStr } from "../lib/cli.ts";

type Args = {
  graph?: string;
  providers?: string;
  nodeLock?: string;
};

async function main() {
  const a = {
    graph: getFlagStr("graph", "").trim(),
    providers: getFlagStr("providers", "").trim(),
    nodeLock: getFlagStr("nodeLock", "").trim() || getFlagStr("node-lock", "").trim(),
  } satisfies Args;
  const comp = await readCompositeGraph({
    graphPath: a.graph || undefined,
    providerIndexPath: a.providers || undefined,
    nodeLockIndexPath: a.nodeLock || undefined,
  });
  console.log(JSON.stringify(comp, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
