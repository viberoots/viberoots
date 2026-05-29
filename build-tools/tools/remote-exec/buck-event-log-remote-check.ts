#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { getFlagStr } from "../lib/cli";

export type BuckActionClass =
  | "remote"
  | "cache"
  | "dep-file-cache"
  | "local"
  | "worker"
  | "unknown";

export type BuckActionEvidence = {
  target?: string;
  category?: string;
  identifier?: string;
  labels?: string[];
  classification: BuckActionClass;
  rawExecutor?: string;
};

export type BuckRemoteCheckFinding = {
  target: string;
  message: string;
};

const LOCAL_CLASSES = new Set<BuckActionClass>(["local", "worker", "unknown"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function classifyExecutor(raw?: string): BuckActionClass {
  const value = String(raw || "").toLowerCase();
  if (value === "re" || value === "remote") return "remote";
  if (value === "cache" || value === "actioncache") return "cache";
  if (value === "redepfilecache" || value === "dep-file-cache") return "dep-file-cache";
  if (value === "local") return "local";
  if (value === "worker" || value === "workerinit") return "worker";
  return "unknown";
}

export function parseWhatRanRecord(record: unknown): BuckActionEvidence {
  const item = asRecord(record);
  const repro = asRecord(item.reproducer);
  const action = asRecord(item.action);
  const identity = asRecord(action.identity);
  const rawExecutor = firstString(item.executor, repro.executor, action.executor);
  const target = firstString(item.target, action.target, identity.target, item.owner, action.owner);
  return {
    target,
    category: firstString(item.category, action.category, identity.category),
    identifier: firstString(item.identifier, action.identifier, identity.identifier),
    labels: stringArray(item.labels).concat(stringArray(action.labels)),
    classification: classifyExecutor(rawExecutor),
    rawExecutor,
  };
}

export function parseWhatRanText(text: string): BuckActionEvidence[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parsed = (() => {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  })();
  if (Array.isArray(parsed)) return parsed.map(parseWhatRanRecord);
  if (parsed) {
    const records =
      asRecord(parsed).actions || asRecord(parsed).records || asRecord(parsed).whatRan;
    if (Array.isArray(records)) return records.map(parseWhatRanRecord);
    return [parseWhatRanRecord(parsed)];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseWhatRanRecord(JSON.parse(line)));
}

export function validateRemoteConformance(opts: {
  actions: BuckActionEvidence[];
  remoteReadyTargets: string[];
  allowLocalTargets?: string[];
  allowDepFileCache?: boolean;
}): BuckRemoteCheckFinding[] {
  const ready = new Set(opts.remoteReadyTargets);
  const allowed = new Set(opts.allowLocalTargets || []);
  const findings: BuckRemoteCheckFinding[] = [];
  for (const action of opts.actions) {
    const target = action.target || "<unknown>";
    if (!ready.has(target) || allowed.has(target)) continue;
    if (action.classification === "dep-file-cache" && opts.allowDepFileCache) continue;
    if (LOCAL_CLASSES.has(action.classification)) {
      findings.push({
        target,
        message: `remote-ready action ran as ${action.classification}`,
      });
    }
  }
  return findings;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = getFlagStr("what-ran", "");
  if (!input) throw new Error("--what-ran is required");
  const findings = validateRemoteConformance({
    actions: parseWhatRanText(fs.readFileSync(input, "utf8")),
    remoteReadyTargets: csv(getFlagStr("remote-ready-targets", "")),
    allowLocalTargets: csv(getFlagStr("allow-local-targets", "")),
    allowDepFileCache: getFlagStr("allow-dep-file-cache", "") === "true",
  });
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`${finding.target}: ${finding.message}\n`);
    process.exit(2);
  }
}
