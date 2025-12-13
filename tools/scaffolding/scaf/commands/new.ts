import type { ScafFlags } from "../types.ts";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { printSkip } from "../../../lib/errors.ts";
import { confirmOrExit } from "../confirm.ts";
import { exists } from "../fs.ts";
import { isLanguageEnabled } from "../language-enablement.ts";
import { runCopierCopy } from "../copier/copy.ts";
import { runPostSteps } from "../copier/post-steps.ts";
import { recordSource } from "../copier/record-source.ts";
import { resolveDestination } from "../templates/destination.ts";
import { normalizeTemplateName } from "../templates/names.ts";
import { usage } from "../usage.ts";

export async function cmdNew(args: string[], flags: ScafFlags) {
  const [language, templateRaw, name] = args;
  if (!language || !templateRaw || !name) {
    usage();
    process.exit(2);
  }
  if (language !== "language" && language !== "node" && !(await isLanguageEnabled(language))) {
    printSkip("missing-language", `${language}`);
    return;
  }
  const template = normalizeTemplateName(templateRaw);
  const root = path.join("tools", "scaffolding", "templates", language, template);
  if (!(await exists(root))) {
    console.error(`template not found: ${language}/${template}`);
    process.exit(1);
  }
  const destInfo = resolveDestination(language, template, name, flags["path"]);
  const dest = language === "language" && template === "kit" ? "." : destInfo.path;
  const data: Record<string, any> = { name, language, template };

  if (language === "python") {
    const moduleName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    data["module_name"] = moduleName || "app";
  }
  for (const [k, v] of Object.entries(flags)) {
    if (!["path", "json"].includes(k)) {
      data[k] = v;
    }
  }
  if (language === "node") {
    const noTests = (flags["no-tests"] || "").toString().toLowerCase() === "true";
    if (noTests) {
      data["includeNodeTests"] = false;
    } else if (typeof data["includeNodeTests"] === "undefined") {
      data["includeNodeTests"] = true;
    }
  }
  if (language === "language" && template === "kit") {
    if (!data["lang_id"]) data["lang_id"] = name;
    if (!data["display_name"]) {
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      data["display_name"] = cap;
    }
  }

  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const isLangKit = language === "language" && template === "kit";

  if (destInfo.needsConfirm && !isLangKit) {
    await confirmOrExit(`No resolver mapping found. Create at ${dest}?`, yes, dry);
  }

  const destExists = await exists(dest);
  const isNonEmpty = destExists
    ? (await fsp.readdir(dest).catch(() => [] as string[])).length > 0
    : false;
  if (isNonEmpty && !yes && !isLangKit) {
    await confirmOrExit(`Directory not empty: ${dest}\nOverwrite via copier?`, false, dry);
  }
  if (dry) {
    console.log(`[dry-run] would create/update scaffold at: ${dest}`);
    return;
  }

  try {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
  } catch {}
  await runCopierCopy(root, dest, data);
  await recordSource(dest, language, template);
  await runPostSteps(dest);

  if (isLangKit) {
    const withPlanner = ["true", "1", "yes"].includes((flags["with-planner"] || "").toLowerCase());
    if (withPlanner) {
      const langId = (data["lang_id"] as string) || name;
      const cfgDir = path.join("tools", "nix", "planner");
      const cfgPath = path.join(cfgDir, `${langId}.config.ts`);
      await fsp.mkdir(cfgDir, { recursive: true });
      if (!(await exists(cfgPath))) {
        const cfg =
          `export default {\n` +
          `  id: ${JSON.stringify(langId)},\n` +
          `  detect: { requireAnyLabels: [${JSON.stringify(`lang:${langId}`)}] },\n` +
          `  kindRules: [\n` +
          `    { ifHasAnyLabel: ["kind:bin"], thenKind: "bin" },\n` +
          `    { ifHasAnyLabel: ["kind:lib"], thenKind: "lib" }\n` +
          `  ],\n` +
          `  modulesFile: { inheritFromGo: true },\n` +
          `};\n`;
        await fsp.writeFile(cfgPath, cfg, "utf8");
      }
      try {
        await $`node tools/dev/planner-gen.ts --lang ${langId}`;
        console.log(`planner generated: tools/nix/planner/${langId}.nix`);
      } catch (e) {
        console.warn("warning: planner-gen failed:", e);
      }
    }
  }

  if (language === "node") {
    const noTests =
      (flags["no-tests"] || "").toString().toLowerCase() === "true" ||
      data["includeNodeTests"] === false;
    if (noTests) {
      try {
        const testDir = path.join(dest, "test");
        await fsp.rm(testDir, { recursive: true, force: true });
      } catch {}
    }
  }

  console.log("created:", dest);
}
