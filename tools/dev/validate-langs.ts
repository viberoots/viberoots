#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Lazy load ajv so the script remains fast if not installed; provide a friendly hint.
let Ajv: any;
try {
  Ajv = require("ajv");
} catch {
  console.error(
    "Missing dependency: ajv. Install it or run via dev shell to validate tools/nix/langs.json",
  );
  process.exit(2);
}

type ManifestLike = any;

async function main(): Promise<void> {
  const repo = process.cwd();
  const manifestPath = path.join(repo, "tools/nix/langs.json");
  const schemaPath = path.join(repo, "tools/dev/langs.schema.json");
  const exists = await fs.pathExists(manifestPath);
  if (!exists) {
    console.log("langs.json not found — OK (nothing to validate)");
    return;
  }
  const [raw, schemaText] = await Promise.all([
    fs.readFile(manifestPath, "utf8"),
    fs.readFile(schemaPath, "utf8"),
  ]);
  let doc: ManifestLike;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON in tools/nix/langs.json:", e);
    process.exit(1);
  }
  let schema: any;
  try {
    schema = JSON.parse(schemaText);
  } catch (e) {
    console.error("Invalid JSON Schema in tools/dev/langs.schema.json:", e);
    process.exit(1);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(doc);
  if (!ok) {
    console.error("langs.json validation failed:\n");
    for (const err of validate.errors || []) {
      console.error(`- ${err.instancePath || "."} ${err.message}`);
    }
    process.exit(1);
  }
  console.log("langs.json: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
