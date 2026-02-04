import type { ScafFlags } from "../types.ts";

import { discoverScaffolds } from "../scaffolds/discover.ts";

export async function cmdLs(flags: ScafFlags) {
  const rows = await discoverScaffolds(".");
  if (flags["json"] === "true") {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    const ref = r.templateRef ? `\t${r.templateRef}` : "";
    console.log(`${r.path}\t${r.language}\t${r.template}\t${r.name}${ref}`);
  }
}
