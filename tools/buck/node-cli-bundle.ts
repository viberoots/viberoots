#!/usr/bin/env zx-wrapper
/**
 * tools/buck/node-cli-bundle.ts
 * Build a single-file Node CLI bundle via Nix and copy it to $OUT.
 *
 * Args:
 *   --importer  Importer directory (e.g., apps/demo)
 *   --name      CLI name (used for output filename when copying)
 *   --out       Destination path (Buck's $OUT)
 *   --entry     Optional entry file (unused by the flake today; accepted for future)
 */
import path from "node:path";
import * as fsp from "node:fs/promises";

type Args = {
  importer?: string;
  name?: string;
  out?: string;
  entry?: string;
};

const args = (global as any).argv as Args;

function sanitizeImporterAttr(s: string): string {
  // Keep in sync with tools/nix/templates-common.nix sanitizeName
  return s.replaceAll("//", "").replaceAll(":", "-").replaceAll("/", "-").replaceAll(" ", "-");
}

function basenameImporter(s: string): string {
  // apps/demo -> demo, "." -> "."
  const b = path.basename(s);
  return b || s;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

async function main() {
  const importer = String(args.importer || "").trim();
  const name = String(args.name || "").trim();
  const out = String(args.out || "").trim();
  // entry accepted for forward compatibility; unused in current flake pipeline
  // const entry = (args.entry ?? "").toString().trim();

  if (!importer) fail("node-cli-bundle: --importer is required (e.g., apps/demo)");
  if (!name) fail("node-cli-bundle: --name is required (e.g., demo)");
  if (!out) fail("node-cli-bundle: --out is required (Buck's $OUT)");

  const attr = `node-cli.${sanitizeImporterAttr(importer)}`;
  const { stdout } = await $`nix build .#${attr} --no-link --accept-flake-config --print-out-paths`;
  const storePath =
    String(stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  if (!storePath) fail(`node-cli-bundle: nix build produced no out path for ${attr}`);

  const expected = path.join(storePath, `${basenameImporter(importer)}.bundle.js`);
  try {
    await fsp.access(expected);
  } catch {
    fail(
      `node-cli-bundle: expected bundle missing: ${expected}\n` +
        `Ensure flake packages.<system>.node-cli.<sanitize(importer)> emits <basename(importer)>.bundle.js`,
    );
  }

  // Copy to Buck's $OUT and make executable
  await fsp.mkdir(path.dirname(out), { recursive: true }).catch(() => {});
  await fsp.copyFile(expected, out);
  try {
    await fsp.chmod(out, 0o755);
  } catch {}
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
