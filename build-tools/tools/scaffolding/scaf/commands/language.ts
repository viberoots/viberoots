import type { ScafFlags } from "../types";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { confirmOrExit } from "../confirm";
import { runScafNodeTool } from "../command-runner";
import { exists } from "../fs";
import { formatScaffoldPaths } from "./new-helpers";
import { cmdNew } from "./new";
import { languageGraduationGaps } from "../../../lib/lang-contracts";
import { readManifest } from "../../../dev/langs-diagnose/manifest";

function languageKitFormatTargets(id: string): string[] {
  return [
    path.join(id),
    path.join("patches", id),
    path.join("build-tools", "tools", "buck", "providers", `${id}.ts`),
    path.join("build-tools", "tools", "buck", "exporter", "lang", `${id}.ts`),
    path.join("build-tools", "tools", "nix", "planner", `${id}.nix`),
    path.join("build-tools", "tools", "nix", "templates", `${id}.nix`),
    path.join("build-tools", "tools", "nix", "langs.json"),
    path.join("build-tools", "tools", "tests", id),
  ];
}

export async function cmdLanguage(args: string[], flags: ScafFlags) {
  const [sub, id] = args;
  if (!sub || (sub !== "doctor" && !id)) {
    console.error(
      "Usage: scaf language <new|plan|doctor|remove> <id> [flags]\n" +
        "Examples:\n" +
        "  scaf language new rust --display-name=Rust --kinds=bin,lib --manifest=write\n" +
        "  scaf language plan python --with-exporter --manifest=print\n" +
        "  scaf language doctor\n" +
        "  scaf language remove kotlin --yes",
    );
    process.exit(2);
  }
  if (sub === "doctor") {
    const json = flags["json"] === "true";
    const { enabled, langs } = await readManifest();
    const languages = [...langs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([languageId, language]) => {
        const gaps = languageGraduationGaps(language.hermetic);
        if (language.hermetic?.status !== "graduated") gaps.unshift("status is scaffold");
        if (enabled.has(languageId) && gaps.length > 0) gaps.unshift("enabled before graduation");
        return { id: languageId, enabled: enabled.has(languageId), graduationGaps: gaps };
      });
    const payload = {
      languages,
      ok: languages.every((language) => language.graduationGaps.length === 0),
    };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else {
      for (const language of languages) {
        console.log(
          `${language.id}: ${language.graduationGaps.length === 0 ? "graduated" : `blocked (${language.graduationGaps.join(", ")})`}`,
        );
      }
    }
    return;
  }
  if (sub === "plan") {
    const display = flags["display-name"] || id.charAt(0).toUpperCase() + id.slice(1);
    const kinds = (flags["kinds"] || "bin,lib").split(",").map((s) => s.trim());
    const withPlanner = (flags["with-planner"] ?? "true").toString();
    const withProvider = (flags["with-provider"] ?? "true").toString();
    const withExporter = (flags["with-exporter"] ?? "true").toString();
    const manifest = (flags["manifest"] || "write").toString();
    const willCreate = [
      `build-tools/tools/nix/planner/${id}.nix`,
      `build-tools/tools/buck/providers/${id}.ts`,
      `build-tools/tools/buck/exporter/lang/${id}.ts`,
      `build-tools/tools/scaffolding/templates/${id}/...`,
      `patches/${id}/.gitkeep`,
      `docs/handbook/${id}-notes.md`,
      `build-tools/tools/tests/${id}/contract/...`,
    ];
    console.log(
      JSON.stringify(
        {
          id,
          displayName: display,
          kinds,
          withPlanner,
          withProvider,
          withExporter,
          manifest,
          willCreate,
          manifestFragment: { id, displayName: display },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (sub === "new") {
    await cmdNew(["language", "kit", id], flags);

    const noManifest = flags["no-manifest"] === "true";
    const manifestMode = (flags["manifest"] || (noManifest ? "skip" : "write")).toString();
    const display = flags["display-name"] || id.charAt(0).toUpperCase() + id.slice(1);
    const kinds = (flags["kinds"] || "bin,lib")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const fragment = {
      id,
      displayName: display,
      requiredPaths: [
        `viberoots/build-tools/tools/nix/planner/${id}.nix`,
        `viberoots/build-tools/tools/buck/exporter/lang/${id}.ts`,
        `viberoots/build-tools/tools/buck/providers/${id}.ts`,
      ],
      kinds,
      templatesDir: `viberoots/build-tools/tools/scaffolding/templates/${id}`,
      hermetic: {
        status: "scaffold",
        sourceRoles: false,
        dependencyReconciliation: false,
        immutableBundleInputs: false,
        storeQualifiedToolchain: false,
        selectorTransport: false,
        sandboxNetwork: false,
        remoteExecution: false,
        publicationAdmission: false,
        reproducibilityMatrixIds: [],
      },
    } as const;

    async function writeManifestEntry(): Promise<void> {
      const p = path.join("viberoots", "build-tools", "tools", "nix", "langs.json");
      const existsFile = await exists(p);
      if (!existsFile) {
        const doc = { enabled: [], languages: [fragment] } as any;
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
        await runScafNodeTool("build-tools/tools/dev/validate-langs.ts");
        return;
      }
      let raw: string = await fsp.readFile(p, "utf8").catch(() => "");
      if (!raw.trim()) raw = "{}";
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Cannot update invalid language manifest ${p}: ${String(error)}`);
      }
      if (Array.isArray(json)) {
        const arr = json as any[];
        if (!arr.find((e) => e && e.id === id)) arr.push(fragment);
        await fsp.writeFile(p, JSON.stringify(arr, null, 2) + "\n", "utf8");
      } else if (json && typeof json === "object") {
        const langs = Array.isArray(json.languages) ? json.languages : [];
        if (!langs.find((e: any) => e && e.id === id)) langs.push(fragment);
        json.languages = langs;
        json.enabled = Array.isArray(json.enabled) ? json.enabled : [];
        await fsp.writeFile(p, JSON.stringify(json, null, 2) + "\n", "utf8");
      } else {
        const doc = { enabled: [], languages: [fragment] } as any;
        await fsp.writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
      }
      await runScafNodeTool("build-tools/tools/dev/validate-langs.ts");
    }

    if (manifestMode === "write") await writeManifestEntry();
    else if (manifestMode === "print") {
      console.log(JSON.stringify({ manifestFragment: fragment }, null, 2));
    }

    await formatScaffoldPaths(languageKitFormatTargets(id));

    console.log(
      [
        "\nNext steps:",
        `- Edit build-tools/tools/buck/exporter/lang/${id}.ts to implement detection/labels`,
        `- Edit build-tools/tools/buck/providers/${id}.ts to add provider wiring`,
        `- Edit build-tools/tools/nix/planner/${id}.nix to route build kinds (bin/lib)`,
        `- Complete every hermetic graduation gate and add matrix IDs before enabling ${id}`,
        `- Add tests under build-tools/tools/tests/${id}/contract/`,
        "- Run u after reviewing the scaffold to reconcile generated language metadata",
        `- Run: build-tools/tools/dev/langs-diagnose.ts --lang ${id} to verify status`,
      ].join("\n"),
    );
    return;
  }
  if (sub === "remove") {
    const yes = flags["yes"] === "true";
    const dry = flags["dry-run"] === "true";
    const summary = `Remove language ${id}: templates/providers/exporter/planner (non-destructive for user code)`;
    await confirmOrExit(summary, yes, dry);
    const rm = async (p: string) => fsp.rm(p, { recursive: true, force: true }).catch(() => {});
    await rm(path.join("build-tools/tools/nix/planner", `${id}.nix`));
    await rm(path.join("build-tools/tools/buck/providers", `${id}.ts`));
    await rm(path.join("build-tools/tools/buck/exporter/lang", `${id}.ts`));
    await rm(path.join("build-tools/tools/scaffolding/templates", id));
    await rm(path.join("patches", id));
    console.log("remove OK");
    return;
  }
  console.error("Unknown subcommand for language");
  process.exit(2);
}
