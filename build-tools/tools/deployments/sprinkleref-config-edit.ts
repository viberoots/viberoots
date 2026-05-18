#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { readFlagStrFromTokens } from "../lib/argv";
import { stripJsonComments } from "./json-comments";
import { readSprinkleRefConfig, validateConfig } from "./sprinkleref-config";
import { assertBootstrapCategoryCanWrite } from "./sprinkleref-bootstrap-guard";
import type { SprinkleRefBackendConfig, SprinkleRefConfigFile } from "./sprinkleref-types";

export type ResolverEntryMode = "add" | "update";

export async function editResolverEntry(opts: {
  configPath: string;
  category: string;
  backend: SprinkleRefBackendConfig;
  mode: ResolverEntryMode;
  overwriteExisting?: boolean;
  createMissing?: boolean;
}) {
  assertBootstrapCategoryCanWrite({
    category: opts.category,
    backend: opts.backend,
  });
  const text = await fs.readFile(opts.configPath, "utf8");
  const parsed = JSON.parse(stripJsonComments(text)) as SprinkleRefConfigFile;
  const categories = parsed.categories || {};
  const resolved = await readSprinkleRefConfig(opts.configPath);
  const exists = Object.prototype.hasOwnProperty.call(resolved.categories, opts.category);
  const existsInFile = Object.prototype.hasOwnProperty.call(categories, opts.category);
  if (opts.mode === "add" && exists && !opts.overwriteExisting) {
    throw new Error(`resolver category ${opts.category} already exists`);
  }
  if (opts.mode === "update" && !exists && !opts.createMissing) {
    throw new Error(`resolver category ${opts.category} is missing`);
  }
  const nextCategories = { ...resolved.categories, [opts.category]: opts.backend };
  validateConfig(
    {
      defaultCategory: parsed.defaultCategory || resolved.defaultCategory || opts.category,
      profiles: resolved.profiles,
      categories: nextCategories,
    },
    opts.configPath,
  );
  await fs.writeFile(
    opts.configPath,
    writeCategoryEntry(text, opts.category, opts.backend, existsInFile),
    "utf8",
  );
}

export function resolverBackendFromArgs(argv: string[]): SprinkleRefBackendConfig {
  const backend = readFlagStrFromTokens("backend", "", argv).trim();
  if (!backend) throw new Error("--resolver-entry requires --backend");
  const fields: Record<string, string> = {};
  for (const [flag, key] of [
    ["file", "file"],
    ["service", "service"],
    ["host", "host"],
    ["project-id", "projectId"],
    ["project-ref", "projectRef"],
    ["default-environment", "defaultEnvironment"],
    ["default-path", "defaultPath"],
    ["client-id-env", "clientIdEnv"],
    ["client-secret-env", "clientSecretEnv"],
    ["token-env", "tokenEnv"],
    ["scope", "scope"],
    ["name-prefix", "namePrefix"],
  ]) {
    const value = readFlagStrFromTokens(flag, "", argv).trim();
    if (value) fields[key] = value;
  }
  return { backend: backend as SprinkleRefBackendConfig["backend"], ...fields };
}

function writeCategoryEntry(
  text: string,
  category: string,
  backend: SprinkleRefBackendConfig,
  exists: boolean,
) {
  const categories = findPropertyObject(text, "categories");
  if (!categories) throw new Error("resolver config missing categories object");
  const rendered = renderEntry(category, backend, indentOf(text, categories.start));
  if (!exists) return insertEntry(text, categories, rendered);
  const entry = findPropertyObject(text.slice(categories.open + 1, categories.close), category);
  if (!entry) throw new Error(`resolver category ${category} is missing`);
  const start = categories.open + 1 + entry.propertyStart;
  const end = categories.open + 1 + entry.propertyEnd;
  return text.slice(0, start) + rendered + (entry.hasTrailingComma ? "," : "") + text.slice(end);
}

function insertEntry(
  text: string,
  categories: { open: number; close: number; start: number },
  rendered: string,
) {
  const before = text.slice(0, categories.close).replace(/\s*$/, "");
  const suffix = text.slice(categories.close);
  const needsComma = !before.endsWith("{");
  return `${before}${needsComma ? "," : ""}\n${rendered}\n${" ".repeat(indentOf(text, categories.start))}${suffix}`;
}

function renderEntry(category: string, backend: SprinkleRefBackendConfig, indent: number) {
  const body = JSON.stringify({ [category]: backend }, null, 2)
    .slice(2, -2)
    .split("\n")
    .map((line) => `${" ".repeat(indent + 2)}${line}`)
    .join("\n");
  return body;
}

function findPropertyObject(text: string, name: string) {
  const key = JSON.stringify(name);
  const keyIndex = text.indexOf(key);
  if (keyIndex < 0) return undefined;
  const colon = text.indexOf(":", keyIndex + key.length);
  const open = text.indexOf("{", colon);
  if (colon < 0 || open < 0) return undefined;
  const close = matchingBrace(text, open);
  const lineStart = text.lastIndexOf("\n", keyIndex) + 1;
  const hasTrailingComma = text[close + 1] === ",";
  const propertyEnd = close + 1 + (hasTrailingComma ? 1 : 0);
  return { propertyStart: lineStart, propertyEnd, start: keyIndex, open, close, hasTrailingComma };
}

function matchingBrace(text: string, open: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const char = text[i] || "";
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  throw new Error("resolver config has unbalanced braces");
}

function indentOf(text: string, index: number) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  return text.slice(lineStart, index).match(/^\s*/)?.[0].length || 0;
}
