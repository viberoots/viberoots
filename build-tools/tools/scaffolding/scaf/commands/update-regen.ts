import type { ScafFlags } from "../types.ts";

import path from "node:path";

import * as fsp from "node:fs/promises";

import {
  copierRecopyOrUpdate,
  copierUpdate,
  recopyUsingRecordedSource,
} from "../../lib/scaffold-utils.ts";
import { confirmOrExit } from "../confirm.ts";
import { readRegenInfo } from "../copier/regen-info.ts";
import { runCopierCopy } from "../copier/copy.ts";
import { runPostSteps } from "../copier/post-steps.ts";
import { discoverScaffolds } from "../scaffolds/discover.ts";

export async function cmdUpdateOrRegen(mode: "update" | "regen", args: string[], flags: ScafFlags) {
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const targets = args.length ? args : ["all"];
  const discovered = await discoverScaffolds(".");
  const chosen = targets[0] === "all" ? discovered.map((d) => d.path) : targets;
  await confirmOrExit(
    `${mode} ${chosen.length} scaffold(s):\n` + chosen.map((p) => ` - ${p}`).join("\n"),
    yes,
    dry,
  );
  for (const t of chosen) {
    if (mode === "regen") {
      const { src, data } = await readRegenInfo(t);
      if (src) {
        const parent = path.dirname(t);
        const base = path.basename(t);
        const staged = path.join(parent, `${base}.scaf-stage-${Date.now()}`);
        await fsp.rename(t, staged);
        try {
          await runCopierCopy(src, t, data);
          await runPostSteps(t);
          await fsp.rm(staged, { recursive: true, force: true });
        } catch (err) {
          await fsp.rm(t, { recursive: true, force: true }).catch(() => {});
          await fsp.rename(staged, t).catch(() => {});
          throw err;
        }
      } else {
        try {
          await recopyUsingRecordedSource(t);
        } catch {
          await copierRecopyOrUpdate(t);
        }
        await runPostSteps(t);
      }
    } else {
      try {
        await recopyUsingRecordedSource(t);
      } catch {
        await copierUpdate(t);
      }
      await runPostSteps(t);
    }
    console.log(`${mode} OK:`, t);
  }
}
