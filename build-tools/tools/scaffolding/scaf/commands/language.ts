import type { ScafFlags } from "../types.ts";

import path from "node:path";

import * as fsp from "node:fs/promises";

import { confirmOrExit } from "../confirm.ts";
import { exists } from "../fs.ts";
import { cmdNew } from "./new.ts";

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
    const payload = { languages: [], note: "diagnostics stub; implement in PR 28" } as const;
    console.log(json ? JSON.stringify(payload, null, 2) : payload.note);
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
        `build-tools/tools/nix/planner/${id}.nix`,
        `build-tools/tools/buck/exporter/lang/${id}.ts`,
        `build-tools/tools/buck/providers/${id}.ts`,
      ],
      kinds,
      templatesDir: `build-tools/tools/scaffolding/templates/${id}`,
    } as const;

    async function writeManifestEntry(): Promise<void> {
      const p = path.join("build-tools", "tools", "nix", "langs.json");
      const existsFile = await exists(p);
      if (!existsFile) {
        const doc = { enabled: [id], languages: [fragment] } as any;
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
        return;
      }
      let raw: string = await fsp.readFile(p, "utf8").catch(() => "");
      if (!raw.trim()) raw = "{}";
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        json = {};
      }
      if (Array.isArray(json)) {
        const arr = json as any[];
        if (!arr.find((e) => e && e.id === id)) arr.push(fragment);
        await fsp.writeFile(p, JSON.stringify(arr, null, 2) + "\n", "utf8");
      } else if (json && typeof json === "object") {
        const langs = Array.isArray(json.languages) ? json.languages : [];
        if (!langs.find((e: any) => e && e.id === id)) langs.push(fragment);
        const enabled = new Set<string>(Array.isArray(json.enabled) ? json.enabled : []);
        enabled.add(id);
        json.languages = langs;
        json.enabled = Array.from(enabled).sort();
        await fsp.writeFile(p, JSON.stringify(json, null, 2) + "\n", "utf8");
      } else {
        const doc = { enabled: [id], languages: [fragment] } as any;
        await fsp.writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
      }
      try {
        await $`node build-tools/tools/dev/validate-langs.ts`;
      } catch {}
    }

    if (manifestMode === "write") await writeManifestEntry();
    else if (manifestMode === "print") {
      console.log(JSON.stringify({ manifestFragment: fragment }, null, 2));
    }

    const doCodegen = flags["no-codegen"] === "true" ? false : true;
    if (doCodegen) {
      try {
        await $`node build-tools/tools/dev/codegen.ts`;
      } catch (e) {
        console.warn("warning: codegen failed:", e);
      }
    }

    console.log(
      [
        "\nNext steps:",
        `- Edit build-tools/tools/buck/exporter/lang/${id}.ts to implement detection/labels`,
        `- Edit build-tools/tools/buck/providers/${id}.ts to add provider wiring`,
        `- Edit build-tools/tools/nix/planner/${id}.nix to route build kinds (bin/lib)`,
        `- Add tests under build-tools/tools/tests/${id}/contract/ if desired`,
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
