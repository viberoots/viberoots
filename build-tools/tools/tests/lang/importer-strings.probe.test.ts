#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { sanitizeName } from "../../lib/sanitize";

type Case = {
  target: string;
  importer: string;
};

const cases: Case[] = [
  { target: "//build-tools/tools/tests/lang/importer_strings:dot", importer: "." },
  { target: "//build-tools/tools/tests/lang/importer_strings:apps_web", importer: "apps/web" },
  {
    target: "//build-tools/tools/tests/lang/importer_strings:libs_some_tool",
    importer: "libs/some_tool",
  },
  {
    target: "//build-tools/tools/tests/lang/importer_strings:repeated_slashes_trailing",
    importer: "apps//web/",
  },
];

function displayName(importer: string): string {
  const parts = importer.split("/").filter((p) => p !== "");
  return parts.length > 0 ? parts[parts.length - 1]! : importer;
}

async function buildAndReadOutput(target: string): Promise<string> {
  const inherited = process.env.BUCK_ISOLATION_DIR;
  const iso = inherited && inherited.trim() ? inherited : `importer_strings_${process.pid}`;
  const createdOwnIso = !inherited;
  try {
    await $`buck2 --isolation-dir ${iso} build ${target}`;
    const { stdout } = await $`buck2 --isolation-dir ${iso} targets --show-output ${target}`;
    const out = stdout.trim().split(/\s+/).pop() || "";
    if (!out) throw new Error("no output path for " + target);
    return await fsp.readFile(out, "utf8");
  } finally {
    if (createdOwnIso) {
      try {
        await $`buck2 --isolation-dir ${iso} kill`;
      } catch {}
    }
  }
}

for (const c of cases) {
  const txt = await buildAndReadOutput(c.target);
  const [sanitized, display] = txt.trimEnd().split("\n");

  const wantSanitized = sanitizeName(c.importer);
  const wantDisplay = displayName(c.importer);

  if (sanitized !== wantSanitized) {
    console.error(
      `sanitize_importer_for_nix_attr mismatch for importer='${c.importer}': starlark='${sanitized}' ts='${wantSanitized}'`,
    );
    process.exit(2);
  }
  if (display !== wantDisplay) {
    console.error(
      `importer_display_name mismatch for importer='${c.importer}': starlark='${display}' ts='${wantDisplay}'`,
    );
    process.exit(2);
  }
}

console.log("OK importer strings probe");
