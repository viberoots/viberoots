import type { ScafFlags } from "../types.ts";

import * as fsp from "node:fs/promises";

import { confirmOrExit } from "../confirm.ts";
import { discoverScaffolds } from "../scaffolds/discover.ts";

export async function cmdDelete(args: string[], flags: ScafFlags) {
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const discovered = await discoverScaffolds(".");
  const targets = args.length ? args : ["all"];
  const chosen = targets[0] === "all" ? discovered.map((d) => d.path) : args;
  await confirmOrExit(
    `Delete ${chosen.length} scaffold(s):\n` + chosen.map((p) => ` - ${p}`).join("\n"),
    yes,
    dry,
  );
  for (const p of chosen) {
    await fsp.rm(p, { recursive: true, force: true });
  }
  console.log("delete OK");
}
