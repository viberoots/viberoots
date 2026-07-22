#!/usr/bin/env zx-wrapper
import { getFlagBool, getFlagStr } from "../lib/cli";
import { runMain } from "../lib/cli-wrap";
import type { DiagnoseOutput } from "./langs-diagnose/types";
import { detectEnabledAndMissing } from "./langs-diagnose/enabled";
import { detectExporterAdapters } from "./langs-diagnose/exporter-adapters";
import { readManifest } from "./langs-diagnose/manifest";
import { detectPlannerPlugins } from "./langs-diagnose/planner-plugins";
import { computeStages } from "./langs-diagnose/stages";
import { printHuman } from "./langs-diagnose/print-human";
import { languageGraduationGaps, patchInvalidationStrategyForLang } from "../lib/lang-contracts";

async function main() {
  const asJson = getFlagBool("json");
  const filterId = getFlagStr("lang", "").trim();

  const { enabled: enabledPref, enabledDeclared, caps, langs } = await readManifest();
  const { enabled, disabled } = await detectEnabledAndMissing(
    langs,
    enabledPref,
    enabledDeclared,
    filterId,
  );
  const adapters = await detectExporterAdapters();
  const plannerPlugins = await detectPlannerPlugins(langs, filterId);
  const stages = await computeStages(enabled, caps, filterId);

  const patchInvalidation = Object.fromEntries(
    enabled
      .slice()
      .sort()
      .map((id) => [id, patchInvalidationStrategyForLang(id)]),
  );
  const graduationGaps = Object.fromEntries(
    [...langs.entries()]
      .filter(([id]) => !filterId || id === filterId)
      .map(([id, lang]) => {
        const gaps = languageGraduationGaps(lang.hermetic);
        if (lang.hermetic?.status !== "graduated") gaps.unshift("status is scaffold");
        return [id, gaps];
      }),
  );

  const out: DiagnoseOutput = {
    enabled: enabled.sort(),
    disabled: disabled.sort((a, b) => a.id.localeCompare(b.id)),
    adapters,
    plannerPlugins,
    stages,
    patchInvalidation,
    graduationGaps,
  };

  if (asJson) console.log(JSON.stringify(out, null, 2));
  else printHuman(out, filterId);
}

runMain(main);
