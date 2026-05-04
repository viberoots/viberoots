import type { ScafFlags } from "../types";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { ensureImporterLockfileFresh } from "../../../dev/update-pnpm-hash/lockfile";
import {
  copierRecopyOrUpdate,
  copierUpdate,
  recopyUsingRecordedSource,
} from "../../lib/scaffold-utils";
import { confirmOrExit } from "../confirm";
import { readRegenInfo } from "../copier/regen-info";
import { runCopierCopy } from "../copier/copy";
import { runPostSteps } from "../copier/post-steps";
import { discoverScaffolds } from "../scaffolds/discover";

function parseYamlScalar(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

async function maybeRegenerateTsImporterLockfile(scaffoldDir: string): Promise<void> {
  const answersFile = path.join(scaffoldDir, ".copier-answers.yml");
  const txt = await fsp.readFile(answersFile, "utf8").catch(() => "");
  if (!txt) return;
  const language = parseYamlScalar(/^language:\s*(.*)$/m.exec(txt)?.[1] || "");
  if (language !== "ts") return;

  const importerFromAnswers = parseYamlScalar(/^importer:\s*(.*)$/m.exec(txt)?.[1] || "");
  const repoRoot = process.cwd();
  const fallbackImporter = path.relative(repoRoot, path.resolve(scaffoldDir)).replace(/\\/g, "/");
  const importer = importerFromAnswers || fallbackImporter;
  if (!importer || importer.startsWith("..") || path.isAbsolute(importer)) return;
  await ensureImporterLockfileFresh({ repoRoot, importer });
}

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
      } catch (err) {
        const msg = String((err as any)?.message || err || "");
        // Only fall back to copier's native update mode for source-resolution issues.
        // For runtime failures (e.g., dirty repo), preserve the primary error and avoid
        // masking it behind copier's template-path tracebacks.
        const sourceResolutionFailure =
          msg.includes("scaf_src_path") ||
          msg.includes("template source") ||
          msg.includes("language/template");
        if (!sourceResolutionFailure) throw err;
        await copierUpdate(t);
      }
      await runPostSteps(t);
    }
    await maybeRegenerateTsImporterLockfile(t);
    console.log(`${mode} OK:`, t);
  }
}
