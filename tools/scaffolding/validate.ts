#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

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
    roots.push(path.join("tools", "scaffolding", "templates"));
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
      const parts = root.split(path.sep);
      const isRoot =
        parts.slice(-3).join("/") === "tools/scaffolding/templates" ||
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
    if (meta.help) {
      if (!quiet) {
        console.error(`meta.json must not contain 'help' (use help.md): ${language}/${template}`);
      }
      process.exit(2);
    }
    const helpMd = path.join(tdir, "help.md");
    if (!(await exists(helpMd))) {
      if (!quiet) {
        console.error(`missing help.md: ${language}/${template}`);
      }
      process.exit(2);
    }
    const md = await fsp.readFile(helpMd, "utf8");
    const required = [
      "# Summary",
      "# Usage",
      "# Variables",
      "# Generated",
      "# Post-steps",
      "# Examples",
    ];
    for (const h of required) {
      if (!md.includes(h)) {
        if (!quiet) {
          console.error(`help.md missing section ${h}: ${language}/${template}`);
        }
        process.exit(2);
      }
    }
  }
  if (!quiet) {
    console.log("OK \u2014 template meta/help validated");
  }
}

async function main() {
  const args = process.argv.slice(2);
  await validateTemplates(args);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
