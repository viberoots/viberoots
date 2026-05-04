#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { getFlagBool, getFlagStr, getPositionals } from "../lib/cli";
import { repoRoot } from "../lib/repo";

type MoveSpec = {
  from: string;
  to: string;
};

function normalizeRel(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function parseMappingLine(line: string): MoveSpec | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const arrowIdx = trimmed.indexOf("->");
  if (arrowIdx >= 0) {
    const from = trimmed.slice(0, arrowIdx).trim();
    const to = trimmed.slice(arrowIdx + 2).trim();
    if (!from || !to) return null;
    return { from, to };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const from = parts[0];
    const to = parts.slice(1).join(" ");
    return { from, to };
  }
  return null;
}

async function loadMovesFromMap(mapPath: string): Promise<MoveSpec[]> {
  const data = await fs.readFile(mapPath, "utf8");
  const moves: MoveSpec[] = [];
  for (const raw of data.split("\n")) {
    const parsed = parseMappingLine(raw);
    if (parsed) moves.push(parsed);
  }
  return moves;
}

function pairPositionals(args: string[]): MoveSpec[] {
  if (args.length === 0) return [];
  if (args.length % 2 !== 0) {
    throw new Error("positional args must be pairs: <from> <to> ...");
  }
  const out: MoveSpec[] = [];
  for (let i = 0; i < args.length; i += 2) {
    out.push({ from: args[i], to: args[i + 1] });
  }
  return out;
}

function resolveWithinRepo(root: string, relOrAbs: string): string {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs);
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`path escapes repo root: ${relOrAbs}`);
  }
  return resolved;
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdirp(dir);
}

async function moveOne(root: string, spec: MoveSpec, dryRun: boolean): Promise<void> {
  const fromRel = normalizeRel(spec.from);
  const toRel = normalizeRel(spec.to);
  const fromAbs = resolveWithinRepo(root, fromRel);
  const toAbs = resolveWithinRepo(root, toRel);
  const fromExists = await fs.pathExists(fromAbs);
  const toExists = await fs.pathExists(toAbs);
  if (!fromExists) throw new Error(`missing source: ${fromRel}`);
  if (toExists) throw new Error(`destination exists: ${toRel}`);
  await ensureParentDir(toAbs);
  if (dryRun) {
    console.log(`[dry-run] git mv ${fromRel} ${toRel}`);
    return;
  }
  await $({ cwd: root })`git mv ${fromRel} ${toRel}`;
  const afterExists = await fs.pathExists(toAbs);
  if (!afterExists) throw new Error(`move failed: ${toRel}`);
}

async function main() {
  const root = repoRoot();
  const mapPath = getFlagStr("map", "");
  const dryRun = getFlagBool("dry-run") || getFlagBool("dryRun");
  const pos = getPositionals();
  let moves: MoveSpec[] = [];
  if (mapPath) {
    const mapAbs = resolveWithinRepo(root, mapPath);
    moves = await loadMovesFromMap(mapAbs);
  } else {
    moves = pairPositionals(pos);
  }
  if (moves.length === 0) {
    throw new Error("no moves specified (use --map or positional pairs)");
  }
  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();
  for (const m of moves) {
    const fromRel = normalizeRel(m.from);
    const toRel = normalizeRel(m.to);
    if (seenFrom.has(fromRel)) throw new Error(`duplicate source: ${fromRel}`);
    if (seenTo.has(toRel)) throw new Error(`duplicate destination: ${toRel}`);
    seenFrom.add(fromRel);
    seenTo.add(toRel);
  }
  for (const m of moves) {
    await moveOne(root, m, dryRun);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
