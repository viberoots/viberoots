#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type ManifestLang = {
  id: string;
  displayName: string;
  requiredPaths: string[];
  optionalPaths?: string[];
  kinds: string[];
  templatesDir: string;
};

type Manifest = {
  enabled?: string[];
  languages: ManifestLang[];
};

function normalizeManifest(raw: any): Manifest {
  // Support legacy array form: [ { id, ... } ]
  if (Array.isArray(raw)) {
    return { enabled: [], languages: raw as ManifestLang[] };
  }
  // Preferred object form with languages array
  if (raw && Array.isArray(raw.languages)) {
    return { enabled: raw.enabled || [], languages: raw.languages as ManifestLang[] };
  }
  // Fallback: empty
  return { enabled: [], languages: [] };
}

async function main() {
  const repo = process.cwd();
  const manifestPath = path.join(repo, "tools/nix/langs.json");
  const outPath = path.join(repo, "tools/lib/langs.ts");
  const txt = await fs.readFile(manifestPath, "utf8");
  const m = normalizeManifest(JSON.parse(txt));
  const header = `#!/usr/bin/env zx-wrapper\nimport fs from "fs-extra";\nimport path from "node:path";\nimport type { ScaffoldingLanguage } from "./lang-contracts";\n`;
  const known = `const KNOWN: ScaffoldingLanguage[] = ${JSON.stringify(m.languages, null, 2)} as any;\n`;
  const body = `\nexport async function detectEnabledLanguages(cwd = process.cwd()): Promise<ScaffoldingLanguage[]> {\n  const cfgPath = path.join(cwd, "tools/nix/langs.json");\n  let preferred: string[] = [];\n  try {\n    const txt = await fs.readFile(cfgPath, "utf8");\n    preferred = (JSON.parse(txt)?.enabled || []) as string[];\n  } catch {}\n  const exists = async (p: string) => fs.pathExists(path.join(cwd, p));\n  const out: ScaffoldingLanguage[] = [];\n  for (const s of KNOWN) {\n    if (preferred.length && !preferred.includes(s.id)) continue;\n    let ok = true;\n    for (const req of s.requiredPaths) {\n      if (!(await exists(req))) { ok = false; break; }\n    }\n    if (ok) out.push(s);\n  }\n  return out;\n}\n\nexport function knownLanguages(): ScaffoldingLanguage[] {\n  return [...KNOWN];\n}\n`;
  const out = header + "\n" + known + body;
  await fs.outputFile(outPath, out, "utf8");
  console.log("wrote", path.relative(repo, outPath));

  // Optional: also emit a Nix-friendly langs.nix for planner/CI consumers
  const langsNix = [
    "# tools/nix/langs.nix — GENERATED FILE — DO NOT EDIT.",
    "# Exposes a simple attribute set mapping language id -> capability flags.",
    "{",
    ...m.languages.map((l) => {
      const caps = (l as any).capabilities || {};
      const keys = Object.keys(caps);
      const capAttrs = keys.map((k) => `    ${k} = ${caps[k] ? "true" : "false"};`).join("\n");
      return `  ${l.id} = {\n${capAttrs}\n  };`;
    }),
    "}",
    "",
  ].join("\n");
  const nixOut = path.join(repo, "tools/nix/langs.nix");
  await fs.outputFile(nixOut, langsNix, "utf8");
  console.log("wrote", path.relative(repo, nixOut));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
