#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getPositionals } from "../lib/cli";
import { templateRootPath } from "./scaf/templates/paths";

async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function validateTemplates(targets: string[], quiet: boolean = false): Promise<void> {
  const roots: string[] = [];
  if (targets.length === 0 || targets[0] === "all") {
    roots.push(templateRootPath());
  } else {
    for (const t of targets) {
      roots.push(t);
    }
  }

  const templateDirs: string[] = [];
  for (const root of roots) {
    const st = await fsp.stat(root).catch(() => null as any);
    if (!st) {
      if (!quiet) {
        console.error(`path not found: ${root}`);
      }
      process.exit(2);
    }
    if (st.isDirectory()) {
      const parts = path.normalize(root).split(path.sep);
      const isRoot =
        parts.slice(-4).join("/") === "viberoots/build-tools/tools/scaffolding/templates" ||
        parts.slice(-3).join("/") === "build-tools/tools/scaffolding/templates" ||
        parts.slice(-1)[0] === "templates";
      if (isRoot) {
        const langs = await fsp.readdir(root);
        for (const l of langs) {
          const ldir = path.join(root, l);
          const tdirs = (await fsp.readdir(ldir, { withFileTypes: true }))
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
          for (const t of tdirs) {
            templateDirs.push(path.join(ldir, t));
          }
        }
      } else {
        templateDirs.push(root);
      }
    } else {
      if (!quiet) {
        console.error(`not a directory: ${root}`);
      }
      process.exit(2);
    }
  }

  for (const tdir of templateDirs) {
    const language = path.basename(path.dirname(tdir));
    const template = path.basename(tdir);
    const metaPath = path.join(tdir, "meta.json");
    if (!(await exists(metaPath))) {
      if (!quiet) {
        console.error(`missing meta.json: ${language}/${template}`);
      }
      process.exit(2);
    }
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    for (const key of ["language", "template"]) {
      if (!meta[key]) {
        if (!quiet) {
          console.error(`meta.json missing ${key}: ${language}/${template}`);
        }
        process.exit(2);
      }
    }
    if (meta.language !== language || meta.template !== template) {
      if (!quiet) {
        console.error(`meta.json language/template mismatch: ${language}/${template}`);
      }
      process.exit(2);
    }
    if (typeof meta.description !== "string") {
      if (!quiet) {
        console.error(`meta.json description must be string: ${language}/${template}`);
      }
      process.exit(2);
    }
    // New rules: help content must be in meta.json.help, and help.md is not allowed
    if (!meta.help || typeof meta.help !== "object") {
      if (!quiet) {
        console.error(`meta.json missing help object: ${language}/${template}`);
      }
      process.exit(2);
    }
    if (typeof meta.help.usage !== "string" || !meta.help.usage.trim()) {
      if (!quiet) {
        console.error(`meta.json help.usage must be non-empty string: ${language}/${template}`);
      }
      process.exit(2);
    }
    if (meta.help.notes && !Array.isArray(meta.help.notes)) {
      if (!quiet) {
        console.error(`meta.json help.notes must be array of strings: ${language}/${template}`);
      }
      process.exit(2);
    }
    if (meta.help.examples && !Array.isArray(meta.help.examples)) {
      if (!quiet) {
        console.error(`meta.json help.examples must be array of strings: ${language}/${template}`);
      }
      process.exit(2);
    }
    const helpMd = path.join(tdir, "help.md");
    if (await exists(helpMd)) {
      if (!quiet) {
        console.error(`help.md must be removed (use meta.json.help): ${language}/${template}`);
      }
      process.exit(2);
    }

    // Require copier.yaml to exist for all templates
    const copierPath = path.join(tdir, "copier.yaml");
    if (!(await exists(copierPath))) {
      if (!quiet) {
        console.error(`missing copier.yaml: ${language}/${template}`);
      }
      process.exit(2);
    }
    const copierTxt = await fsp.readFile(copierPath, "utf8");

    // Go-specific validations (do not apply to other languages)
    if (language === "go") {
      const needVars: Array<{ key: string; pattern: RegExp }> = [
        { key: "name", pattern: /^name:\s*("[^"]*"|''|)\s*$/m },
        { key: "language", pattern: /^language:\s*["']?go["']?\s*$/m },
        { key: "template", pattern: new RegExp(`^template:\\s*["']?${template}["']?\\s*$`, "m") },
        { key: "module", pattern: /^(module:)\s*.*\{\{\s*name\s*\}\}.*$/m },
        { key: "description", pattern: /^description:\s*.+$/m },
        { key: "go_min", pattern: /^go_min:\s*["']?1\.22["']?\s*$/m },
        { key: "license", pattern: /^license:\s*["']?[A-Za-z0-9_.+\-]+["']?\s*$/m },
        { key: "enable_ci", pattern: /^enable_ci:\s*(true|false)\s*$/m },
      ];
      for (const nv of needVars) {
        if (!nv.pattern.test(copierTxt)) {
          if (!quiet) {
            console.error(`copier.yaml missing or invalid ${nv.key}: ${language}/${template}`);
          }
          process.exit(2);
        }
      }

      // Ensure TARGETS uses nix_go_* macros, not raw go_* rules
      const targetsPath = path.join(tdir, "TARGETS");
      if (await exists(targetsPath)) {
        const txt = await fsp.readFile(targetsPath, "utf8");
        const usesNix = /\bnix_go_(library|binary|test)\s*\(/.test(txt);
        const usesRaw = /\bgo_(library|binary|test)\s*\(/.test(txt);
        if (!usesNix || usesRaw) {
          if (!quiet) {
            console.error(
              `TARGETS must use nix_go_* macros and not raw go_*: ${language}/${template}`,
            );
          }
          process.exit(2);
        }
      }
    }
  }
  if (!quiet) {
    console.log("OK — template meta/help validated");
  }
}

async function main() {
  await validateTemplates(getPositionals());
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
