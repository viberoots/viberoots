#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { getFlagStr } from "../lib/cli";

const macroNamePattern = /^[a-z][a-z0-9_]+$/;

function uniqStable(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseStarlarkIndexMacros(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const macros: string[] = [];
  let inIndex = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (line === "## Index") {
        inIndex = true;
        continue;
      }
      if (inIndex) break;
    }
    if (!inIndex) continue;
    const match = line.match(/`([^`]+)`/);
    if (!match) continue;
    const value = match[1].trim();
    if (!macroNamePattern.test(value)) continue;
    macros.push(value);
  }
  return uniqStable(macros);
}

function parseNixGapsInventory(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const macros: string[] = [];
  for (const raw of lines) {
    const match = raw.match(/^- `([^`]+)`/);
    if (!match) continue;
    const value = match[1].trim();
    if (!macroNamePattern.test(value)) continue;
    macros.push(value);
  }
  return uniqStable(macros);
}

async function main() {
  const starlarkPath = getFlagStr("starlark-api", "docs/handbook/starlark-api.md");
  const inventoryPath = getFlagStr("nix-gaps", "docs/handbook/nix-gaps.md");

  const starlarkTxt = await fs.readFile(starlarkPath, "utf8");
  const inventoryTxt = await fs.readFile(inventoryPath, "utf8");

  const starlarkMacros = parseStarlarkIndexMacros(starlarkTxt);
  const inventoryMacros = parseNixGapsInventory(inventoryTxt);

  if (starlarkMacros.length === 0) {
    console.error(`No macros parsed from ${starlarkPath} (Index section).`);
    process.exit(1);
  }
  if (inventoryMacros.length === 0) {
    console.error(`No macros parsed from ${inventoryPath}.`);
    process.exit(1);
  }

  const inventorySet = new Set(inventoryMacros);
  const starlarkSet = new Set(starlarkMacros);

  const missing = starlarkMacros.filter((m) => !inventorySet.has(m));
  const extra = inventoryMacros.filter((m) => !starlarkSet.has(m));

  if (missing.length > 0) {
    console.error("Missing macros in nix-gaps inventory:");
    for (const name of missing) console.error(`- ${name}`);
    process.exit(1);
  }

  if (extra.length > 0) {
    console.warn("Extra macros in nix-gaps inventory (not in starlark index):");
    for (const name of extra) console.warn(`- ${name}`);
  }

  console.log(
    `nix-gaps inventory OK (${starlarkMacros.length} public macros, ${inventoryMacros.length} inventory entries)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
