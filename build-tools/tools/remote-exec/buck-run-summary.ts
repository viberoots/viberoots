#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { getFlagStr } from "../lib/cli";
import { parseWhatRanText, type BuckActionClass } from "./buck-event-log-remote-check";

export type BuckLogCommandName =
  | "what-ran"
  | "summary"
  | "critical-path"
  | "slowest-path"
  | "what-uploaded"
  | "what-materialized";

export type BuckLogCommandResult = {
  command: BuckLogCommandName;
  supported: boolean;
  output: string;
  error?: string;
};

export type BuckRunSummary = {
  selectedProfile?: string;
  configFingerprint?: string;
  target?: string;
  passName?: string;
  actionCounts: Record<BuckActionClass, number>;
  normalizedSummary: string;
  slowestActions: string[];
  uploads: number;
  materializations: number;
  provenance: Record<string, string>;
  unsupportedCommands: BuckLogCommandName[];
};

const COMMANDS: BuckLogCommandName[] = [
  "what-ran",
  "summary",
  "critical-path",
  "slowest-path",
  "what-uploaded",
  "what-materialized",
];

const SECRET_PATTERN = /(token|secret|password|authorization|api[_-]?key)=\S+/gi;

export function fingerprintConfig(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

export function redactBuckSummary(text: string): string {
  return text.replace(SECRET_PATTERN, "$1=<redacted>");
}

export function collectBuckLogCommands(opts: {
  eventLog: string;
  buck2Path?: string;
  runCommand?: (command: BuckLogCommandName) => BuckLogCommandResult;
}): BuckLogCommandResult[] {
  const run =
    opts.runCommand ||
    ((command: BuckLogCommandName) => {
      const res = spawnSync(opts.buck2Path || "buck2", ["log", command, opts.eventLog], {
        encoding: "utf8",
      });
      return {
        command,
        supported: res.status === 0,
        output: String(res.stdout || ""),
        error: res.status === 0 ? undefined : String(res.stderr || ""),
      };
    });
  return COMMANDS.map((command) => run(command));
}

function countActions(text: string): Record<BuckActionClass, number> {
  const counts: Record<BuckActionClass, number> = {
    remote: 0,
    cache: 0,
    "dep-file-cache": 0,
    local: 0,
    worker: 0,
    unknown: 0,
  };
  for (const action of parseWhatRanText(text)) counts[action.classification] += 1;
  return counts;
}

function countLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function provenanceFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys = [
    "VBR_REMOTE_CACHE_ENDPOINT_IDENTITY",
    "VBR_REMOTE_CACHE_PUBLIC_KEY_FINGERPRINT",
    "VBR_REMOTE_CACHE_MANIFEST_DIGEST",
    "VBR_SOURCE_REVISION",
    "VBR_FLAKE_LOCK_FINGERPRINT",
    "VBR_NIX_MATERIALIZATION_REPORT",
  ];
  return Object.fromEntries(
    keys.map((key) => [key, String(env[key] || "").trim()] as const).filter(([, value]) => value),
  );
}

export function buildBuckRunSummary(opts: {
  results: BuckLogCommandResult[];
  selectedProfile?: string;
  configText?: string;
  target?: string;
  passName?: string;
  env?: NodeJS.ProcessEnv;
}): BuckRunSummary {
  const byCommand = new Map(opts.results.map((result) => [result.command, result]));
  const whatRan = byCommand.get("what-ran");
  const summary = byCommand.get("summary");
  const slow =
    byCommand.get("critical-path")?.supported === true
      ? byCommand.get("critical-path")
      : byCommand.get("slowest-path");
  return {
    selectedProfile: opts.selectedProfile,
    configFingerprint: opts.configText
      ? fingerprintConfig(redactBuckSummary(opts.configText))
      : undefined,
    target: opts.target,
    passName: opts.passName,
    actionCounts: whatRan?.supported ? countActions(whatRan.output) : countActions(""),
    normalizedSummary: summary?.supported ? redactBuckSummary(summary.output) : "",
    slowestActions: slow?.supported
      ? redactBuckSummary(slow.output).split(/\r?\n/).filter(Boolean).slice(0, 10)
      : [],
    uploads: byCommand.get("what-uploaded")?.supported
      ? countLines(byCommand.get("what-uploaded")!.output)
      : 0,
    materializations: byCommand.get("what-materialized")?.supported
      ? countLines(byCommand.get("what-materialized")!.output)
      : 0,
    provenance: provenanceFromEnv(opts.env || process.env),
    unsupportedCommands: opts.results
      .filter((result) => !result.supported)
      .map((result) => result.command),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const eventLog = getFlagStr("event-log", "");
  if (!eventLog) throw new Error("--event-log is required");
  const summary = buildBuckRunSummary({
    results: collectBuckLogCommands({ eventLog }),
    selectedProfile: getFlagStr("profile", ""),
    target: getFlagStr("target", ""),
    passName: getFlagStr("pass", ""),
  });
  console.log(JSON.stringify(summary, null, 2));
}
