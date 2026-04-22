#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { NixosSharedHostConfigTopology } from "./nixos-shared-host-install-contract.ts";

const START_MARKER = "# BEGIN nixos-shared-host managed block";
const END_MARKER = "# END nixos-shared-host managed block";
const LEGACY_START_MARKER = "# BEGIN bucknix nixos-shared-host";
const LEGACY_END_MARKER = "# END bucknix nixos-shared-host";

function listTokenFor(topology: NixosSharedHostConfigTopology): string {
  return topology === "flake" ? "modules" : "imports";
}

function blockFor(anchorPath: string): string {
  return [START_MARKER, `      ${anchorPath}`, END_MARKER].join("\n");
}

function normalizeIndent(line: string): string {
  const match = line.match(/^(\s*)/);
  return match?.[1] || "";
}

function removeManagedBlockWithMarkers(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  if (start < 0) return source;
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error("managed config-entry markers are unbalanced");
  const after = end + endMarker.length;
  const suffix = source.slice(after).replace(/^\n/, "");
  const prefix = source.slice(0, start).replace(/\n?$/, "\n");
  return prefix + suffix;
}

function removeManagedBlock(source: string): string {
  return removeManagedBlockWithMarkers(
    removeManagedBlockWithMarkers(source, LEGACY_START_MARKER, LEGACY_END_MARKER),
    START_MARKER,
    END_MARKER,
  );
}

function findAssignment(source: string, token: string): { openIndex: number; closeIndex: number } {
  const match = new RegExp(`${token}\\s*=\\s*\\[`).exec(source);
  if (!match || match.index < 0) {
    throw new Error(`unsupported host config topology: expected '${token} = [' in config entry`);
  }
  const openIndex = source.indexOf("[", match.index);
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return { openIndex, closeIndex: i };
    }
  }
  throw new Error(
    `unsupported host config topology: unterminated '${token} = [' list in config entry`,
  );
}

export function renderConfigEntryInstruction(opts: {
  topology: NixosSharedHostConfigTopology;
  anchorPath: string;
}): string {
  return `${listTokenFor(opts.topology)} = [ ... ${opts.anchorPath} ... ];`;
}

export function configEntryContainsManagedAnchor(source: string, anchorPath: string): boolean {
  const managed =
    (source.includes(START_MARKER) && source.includes(END_MARKER)) ||
    (source.includes(LEGACY_START_MARKER) && source.includes(LEGACY_END_MARKER));
  if (managed && source.includes(anchorPath)) return true;
  return source.includes(anchorLiteralPath(anchorPath));
}

export function installManagedConfigEntry(opts: {
  source: string;
  topology: NixosSharedHostConfigTopology;
  anchorPath: string;
}): string {
  const cleaned = removeManagedBlock(opts.source);
  const { closeIndex } = findAssignment(cleaned, listTokenFor(opts.topology));
  const beforeClose = cleaned.slice(0, closeIndex);
  const afterClose = cleaned.slice(closeIndex);
  const lines = beforeClose.split("\n");
  const indent = normalizeIndent(lines[lines.length - 1] || "  ");
  const block = blockFor(opts.anchorPath)
    .split("\n")
    .map((line, index) => `${index === 1 ? indent : indent}${line}`)
    .join("\n");
  return `${beforeClose}\n${block}\n${afterClose}`;
}

export function uninstallManagedConfigEntry(source: string): string {
  return removeManagedBlock(source);
}

export function managedConfigEntryMarkers() {
  return { start: START_MARKER, end: END_MARKER };
}

export function anchorLiteralPath(anchorPath: string): string {
  return path.posix.normalize(anchorPath);
}
