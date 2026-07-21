#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "../../lib/fs-helpers";
import { DEFAULT_PREBUILD_FINGERPRINT_PATH } from "../../lib/workspace-state-paths";
import { discoverPrebuildInputs } from "./input-discovery";

const FINGERPRINT_SCHEMA = 1;

type FingerprintEntry = {
  path: string;
  hash: string;
};

type PrebuildFingerprint = {
  schema: number;
  inputs: FingerprintEntry[];
  outputs: string[];
};

export type FingerprintFreshness = {
  fresh: boolean;
  reason: string;
};

function normalizeRel(root: string, filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  return rel && !rel.startsWith("../") && rel !== ".." ? rel : abs;
}

function normalizeList(root: string, paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => normalizeRel(root, p)))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function listIncludesAll(values: string[], required: string[]): boolean {
  const set = new Set(values);
  return required.every((value) => set.has(value));
}

async function hashFile(root: string, relPath: string): Promise<string | null> {
  const abs = path.isAbsolute(relPath) ? relPath : path.resolve(root, relPath);
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isFile()) return null;
    const data = await fsp.readFile(abs);
    return `sha256-${crypto.createHash("sha256").update(data).digest("hex")}`;
  } catch {
    return null;
  }
}

async function hashInputs(root: string, inputs: string[]): Promise<FingerprintEntry[] | null> {
  const entries: FingerprintEntry[] = [];
  for (const relPath of normalizeList(root, inputs)) {
    const hash = await hashFile(root, relPath);
    if (!hash) return null;
    entries.push({ path: relPath, hash });
  }
  return entries;
}

function readFingerprint(fingerprintPath: string): PrebuildFingerprint | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fingerprintPath, "utf8"));
    if (parsed?.schema !== FINGERPRINT_SCHEMA) return null;
    if (!Array.isArray(parsed.inputs) || !Array.isArray(parsed.outputs)) return null;
    return {
      schema: parsed.schema,
      inputs: parsed.inputs.map((entry: any) => ({
        path: String(entry?.path || ""),
        hash: String(entry?.hash || ""),
      })),
      outputs: parsed.outputs.map((output: unknown) => String(output)),
    };
  } catch {
    return null;
  }
}

export async function writePrebuildFingerprint(opts: {
  root?: string;
  inputs?: string[];
  outputs: string[];
  fingerprintPath?: string;
}): Promise<void> {
  const root = opts.root || process.cwd();
  const fingerprintPath = path.resolve(
    root,
    opts.fingerprintPath || DEFAULT_PREBUILD_FINGERPRINT_PATH,
  );
  const inputs = opts.inputs || (await discoverPrebuildInputs(root));
  const hashedInputs = await hashInputs(root, inputs);
  if (!hashedInputs) {
    throw new Error("cannot write prebuild fingerprint: unable to hash discovered inputs");
  }
  const outputs = normalizeList(root, opts.outputs);
  const record: PrebuildFingerprint = {
    schema: FINGERPRINT_SCHEMA,
    inputs: hashedInputs,
    outputs,
  };
  await fsp.mkdir(path.dirname(fingerprintPath), { recursive: true });
  await writeIfChanged(fingerprintPath, JSON.stringify(record, null, 2) + "\n");
}

export async function prebuildFingerprintFresh(opts: {
  root?: string;
  inputs?: string[];
  outputs: string[];
  fingerprintPath?: string;
}): Promise<FingerprintFreshness> {
  const root = opts.root || process.cwd();
  const fingerprintPath = path.resolve(
    root,
    opts.fingerprintPath || DEFAULT_PREBUILD_FINGERPRINT_PATH,
  );
  const record = readFingerprint(fingerprintPath);
  if (!record) return { fresh: false, reason: "missing-or-invalid-fingerprint" };

  const currentInputs = normalizeList(root, opts.inputs || (await discoverPrebuildInputs(root)));
  const recordedInputs = normalizeList(
    root,
    record.inputs.map((entry) => entry.path),
  );
  if (!sameList(currentInputs, recordedInputs)) {
    return { fresh: false, reason: "input-set-changed" };
  }

  const currentOutputs = normalizeList(root, opts.outputs);
  const recordedOutputs = normalizeList(root, record.outputs);
  if (!listIncludesAll(recordedOutputs, currentOutputs)) {
    return { fresh: false, reason: "output-set-changed" };
  }
  for (const output of currentOutputs) {
    if (!fs.existsSync(path.resolve(root, output))) {
      return { fresh: false, reason: "missing-output" };
    }
  }

  const recordedHashes = new Map(record.inputs.map((entry) => [entry.path, entry.hash]));
  for (const input of currentInputs) {
    const currentHash = await hashFile(root, input);
    if (!currentHash) return { fresh: false, reason: "input-unreadable" };
    if (recordedHashes.get(input) !== currentHash) {
      return { fresh: false, reason: "input-hash-changed" };
    }
  }

  return { fresh: true, reason: "fresh" };
}
