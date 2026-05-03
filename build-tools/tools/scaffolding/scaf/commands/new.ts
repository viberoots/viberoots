import type { ScafFlags } from "../types.ts";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { ensureImporterLockfileFresh } from "../../../dev/update-pnpm-hash/lockfile.ts";
import { printSkip } from "../../../lib/errors.ts";
import { timeAsyncDetail } from "../../../lib/timing-detail.ts";
import { confirmOrExit } from "../confirm.ts";
import { runScafNodeTool } from "../command-runner.ts";
import {
  formatImporterLockfiles,
  formatScaffoldOutput,
  removeScaffoldTemplateConfig,
  refreshImporterStoreHash,
  templateImportersToRefresh,
} from "./new-helpers.ts";
import { runCopierCopy } from "../copier/copy.ts";
import { runPostSteps } from "../copier/post-steps.ts";
import { recordSource } from "../copier/record-source.ts";
import { exists } from "../fs.ts";
import { isLanguageEnabled } from "../language-enablement.ts";
import { resolveDestination } from "../templates/destination.ts";
import { normalizeTemplateName } from "../templates/names.ts";
import { canonicalTemplateLanguage, isCanonicalTypeScriptTemplate } from "../templates/taxonomy.ts";
import { usage } from "../usage.ts";

export async function cmdNew(args: string[], flags: ScafFlags) {
  const [language, templateRaw, name] = args;
  if (!language || !templateRaw || !name) {
    usage();
    process.exit(2);
  }
  const template = normalizeTemplateName(templateRaw);
  if (language === "node" && isCanonicalTypeScriptTemplate(template)) {
    console.error(`TypeScript templates use 'ts'. Try: scaf new ts ${template} ${name}`);
    process.exit(1);
  }
  if (language !== "language" && !(await isLanguageEnabled(language))) {
    printSkip("missing-language", `${language}`);
    return;
  }
  const canonicalLanguage = canonicalTemplateLanguage(language, template);
  const root = path.join(
    "build-tools",
    "tools",
    "scaffolding",
    "templates",
    canonicalLanguage,
    template,
  );
  const metaPath = path.join(root, "meta.json");
  if (!(await exists(root)) || !(await exists(metaPath))) {
    console.error(`unknown template: ${language}/${template}`);
    process.exit(1);
  }
  const meta = JSON.parse(await fsp.readFile(metaPath, "utf8")) as { requiredFlags?: string[] };
  const missingFlags = (meta.requiredFlags || []).filter((flag) => {
    const value = String(flags[flag] || "").trim();
    return value.length === 0;
  });
  if (missingFlags.length > 0) {
    console.error(
      `missing required scaffold answers for ${canonicalLanguage}/${template}: ` +
        missingFlags.map((flag) => `--${flag}`).join(", "),
    );
    process.exit(2);
  }
  const destInfo = resolveDestination(canonicalLanguage, template, name, flags["path"]);
  const dest = language === "language" && template === "kit" ? "." : destInfo.path;
  const data: Record<string, any> = { name, language: canonicalLanguage, template };

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
  if (canonicalLanguage === "ts") {
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
  await timeAsyncDetail("scafNew runCopierCopy", async () => {
    await runCopierCopy(root, dest, data);
  });
  await timeAsyncDetail("scafNew recordSource", async () => {
    await recordSource(dest, canonicalLanguage, template);
  });
  await timeAsyncDetail("scafNew runPostSteps", async () => {
    await runPostSteps(dest);
  });
  await timeAsyncDetail("scafNew removeScaffoldTemplateConfig", async () => {
    await removeScaffoldTemplateConfig(dest);
  });

  if (isLangKit) {
    const withPlanner = ["true", "1", "yes"].includes((flags["with-planner"] || "").toLowerCase());
    if (withPlanner) {
      const langId = (data["lang_id"] as string) || name;
      const cfgDir = path.join("build-tools", "tools", "nix", "planner");
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
        await timeAsyncDetail("scafNew plannerGen", async () => {
          await runScafNodeTool("build-tools/tools/dev/planner-gen.ts", ["--lang", langId]);
        });
        console.log(`planner generated: build-tools/tools/nix/planner/${langId}.nix`);
      } catch (e) {
        console.warn("warning: planner-gen failed:", e);
      }
    }
  }

  if (canonicalLanguage === "ts") {
    const noTests =
      (flags["no-tests"] || "").toString().toLowerCase() === "true" ||
      data["includeNodeTests"] === false;
    if (noTests) {
      try {
        const testDir = path.join(dest, "test");
        await fsp.rm(testDir, { recursive: true, force: true });
      } catch {}
    }

    const skipLockfileGen = ["true", "1", "yes"].includes(
      String(flags["skip-lockfile-gen"] || "").toLowerCase(),
    );
    const skipStoreHashRefresh = ["true", "1", "yes"].includes(
      String(flags["skip-store-hash-refresh"] || "").toLowerCase(),
    );

    if (skipLockfileGen) {
      printSkip("not-applicable", "skipping importer lockfile regeneration");
    } else {
      // Primary path: ensure importer lockfile is real and consistent with package.json.
      // Nix builders run pnpm with --frozen-lockfile; placeholder lockfiles are not acceptable.
      const repoRoot = process.cwd();
      const importer = (() => {
        // Multi-package templates scaffold under a root destination directory (for example "projects"),
        // so lockfile refresh must point at that rooted importer path rather than repo-root apps/libs.
        if (template === "go-addon" || template === "cpp-addon")
          return path.join(destInfo.path, "libs", name);
        if (template === "wasm-app" || template === "wasm-linking-app")
          return path.join(destInfo.path, "apps", name);
        if (template === "go-cpp-lib") return path.join(destInfo.path, "libs", `${name}-ts`);
        return destInfo.path;
      })();
      const importersToRefresh = templateImportersToRefresh({
        template,
        name,
        destRoot: destInfo.path,
        primaryImporter: importer,
      });
      for (const imp of importersToRefresh) {
        if (imp === importer) {
          await timeAsyncDetail("scafNew ensureImporterLockfileFresh", async () => {
            await ensureImporterLockfileFresh({ repoRoot, importer: imp });
          });
        }
      }
      // Keep lockfile contents stable before computing fixed-output pnpm store hashes.
      await timeAsyncDetail("scafNew formatImporterLockfiles", async () => {
        await formatImporterLockfiles(repoRoot, importersToRefresh);
      });
      if (skipStoreHashRefresh) {
        printSkip("not-applicable", "skipping importer pnpm-store hash refresh");
      } else {
        for (const imp of importersToRefresh) {
          await timeAsyncDetail("scafNew refreshImporterStoreHash", async () => {
            await refreshImporterStoreHash(repoRoot, imp);
          });
        }
      }
    }
  }

  // Keep all scaffold outputs formatting-clean immediately, regardless of language.
  if (!isLangKit) {
    await timeAsyncDetail("scafNew formatScaffoldOutput", async () => {
      await formatScaffoldOutput(dest);
    });
  }

  console.log("created:", dest);
}
