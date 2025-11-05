#!/usr/bin/env zx-wrapper
import { readCompositeGraph } from "../lib/graph-view.ts";

type Args = {
  graph?: string;
  providers?: string;
  nodeLock?: string;
};

async function main() {
  const a = (global as any).argv as Args;
  const comp = await readCompositeGraph({
    graphPath: a.graph,
    providerIndexPath: a.providers,
    nodeLockIndexPath: a.nodeLock,
  });
  console.log(JSON.stringify(comp, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
