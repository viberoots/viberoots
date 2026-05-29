#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { getFlagBool, getFlagStr } from "../lib/cli";

export type StorePathEntry = {
  attr: string;
  path: string;
  narHash?: string;
  expectedOutputIdentity: string;
};

export type NixStoreMaterializationManifest = {
  schemaVersion: "viberoots.nix-store-materialization.v1";
  sourceRevision: string;
  sourceSnapshot: string;
  flakeLockFingerprint: string;
  substituter: {
    endpointIdentity?: string;
    trustedPublicKeys: string[];
  };
  tools: {
    nix: string;
  };
  storePaths: StorePathEntry[];
};

export type MaterializationReport = {
  path: string;
  attr: string;
  narHash?: string;
  substituterUsed: string;
  durationMs: number;
  cache: "hit" | "miss" | "dry-run";
  command: string[];
};

type Runner = (command: string[]) => Promise<{ stdout: string; stderr: string }>;

const SCHEMA = "viberoots.nix-store-materialization.v1";

export function parseMaterializationManifest(input: unknown): NixStoreMaterializationManifest {
  const data = input as Partial<NixStoreMaterializationManifest>;
  if (data?.schemaVersion !== SCHEMA) throw new Error(`manifest schemaVersion must be ${SCHEMA}`);
  requireString(data.sourceRevision, "sourceRevision");
  requireStoreOrRelativePath(data.sourceSnapshot, "sourceSnapshot");
  requireString(data.flakeLockFingerprint, "flakeLockFingerprint");
  requireStorePath(data.tools?.nix, "tools.nix");
  if (data.substituter?.endpointIdentity) {
    requireString(data.substituter.endpointIdentity, "substituter.endpointIdentity");
  }
  if (!Array.isArray(data.substituter?.trustedPublicKeys)) {
    throw new Error("substituter.trustedPublicKeys must be an array");
  }
  if (!Array.isArray(data.storePaths) || data.storePaths.length === 0) {
    throw new Error("storePaths must list at least one required path");
  }
  for (const [index, entry] of data.storePaths.entries()) {
    requireString(entry?.attr, `storePaths[${index}].attr`);
    requireStorePath(entry?.path, `storePaths[${index}].path`);
    requireString(entry?.expectedOutputIdentity, `storePaths[${index}].expectedOutputIdentity`);
  }
  return data as NixStoreMaterializationManifest;
}

export function readMaterializationManifest(file: string): NixStoreMaterializationManifest {
  return parseMaterializationManifest(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function redactMaterializationManifest(
  manifest: NixStoreMaterializationManifest,
): NixStoreMaterializationManifest {
  return {
    ...manifest,
    substituter: {
      endpointIdentity: redactEndpoint(manifest.substituter.endpointIdentity),
      trustedPublicKeys: manifest.substituter.trustedPublicKeys.map((key) => redactKey(key)),
    },
  };
}

export function renderMaterializationCommand(
  manifest: NixStoreMaterializationManifest,
  entry: StorePathEntry,
): string[] {
  const nix = `${manifest.tools.nix}/bin/nix`;
  if (manifest.substituter.endpointIdentity) {
    return [
      nix,
      "copy",
      "--from",
      manifest.substituter.endpointIdentity,
      "--option",
      "trusted-public-keys",
      manifest.substituter.trustedPublicKeys.join(" "),
      entry.path,
    ];
  }
  return [
    nix,
    "build",
    `${manifest.sourceSnapshot}#${entry.attr}`,
    "--no-link",
    "--print-out-paths",
  ];
}

export async function materializeNixStorePaths(opts: {
  manifest: NixStoreMaterializationManifest;
  dryRun?: boolean;
  runner?: Runner;
}): Promise<MaterializationReport[]> {
  const runner = opts.runner || defaultRunner;
  const reports: MaterializationReport[] = [];
  for (const entry of opts.manifest.storePaths) {
    const command = renderMaterializationCommand(opts.manifest, entry);
    const started = performance.now();
    if (opts.dryRun) {
      reports.push(report(entry, opts.manifest, command, started, "dry-run"));
      continue;
    }
    const result = await runner(command);
    const realized = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    if (realized && realized !== entry.path) {
      throw new Error(`materialized ${entry.attr} as ${realized}, expected ${entry.path}`);
    }
    if (!realized) {
      const verify = await runner(pathInfoCommand(opts.manifest, entry));
      const present = verify.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!present.includes(entry.path)) {
        throw new Error(`materialized ${entry.attr} did not verify expected ${entry.path}`);
      }
    }
    reports.push(report(entry, opts.manifest, command, started, realized ? "miss" : "hit"));
  }
  return reports;
}

function pathInfoCommand(
  manifest: NixStoreMaterializationManifest,
  entry: StorePathEntry,
): string[] {
  return [`${manifest.tools.nix}/bin/nix`, "path-info", entry.path];
}

async function defaultRunner(command: string[]): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      code === 0 ? resolve(output) : reject(new Error(output.stderr || `nix exited ${code}`));
    });
  });
}

function report(
  entry: StorePathEntry,
  manifest: NixStoreMaterializationManifest,
  command: string[],
  started: number,
  cache: MaterializationReport["cache"],
): MaterializationReport {
  return {
    path: entry.path,
    attr: entry.attr,
    narHash: entry.narHash,
    substituterUsed: redactEndpoint(manifest.substituter.endpointIdentity),
    durationMs: Math.round(performance.now() - started),
    cache,
    command: redactCommand(command),
  };
}

function requireString(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
}

function requireStorePath(value: unknown, name: string): void {
  requireString(value, name);
  if (!String(value).startsWith("/nix/store/"))
    throw new Error(`${name} must be a /nix/store path`);
}

function requireStoreOrRelativePath(value: unknown, name: string): void {
  requireString(value, name);
  if (String(value).startsWith("http:") || String(value).startsWith("https:")) {
    throw new Error(`${name} must be a declared local source snapshot`);
  }
}

function redactEndpoint(endpoint: string): string {
  if (!endpoint) return "";
  return endpoint.replace(/\/\/([^/@]+)@/, "//<redacted>@");
}

function redactKey(key: string): string {
  return key.replace(/:[A-Za-z0-9+/=._-]{8,}$/, ":<redacted>");
}

function redactCommand(command: string[]): string[] {
  return command.map((part, index) =>
    command[index - 1] === "--option" ? part : redactEndpoint(part),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = readMaterializationManifest(getFlagStr("manifest"));
  const reports = await materializeNixStorePaths({ manifest, dryRun: getFlagBool("dry-run") });
  process.stdout.write(
    `${JSON.stringify({ manifest: redactMaterializationManifest(manifest), reports }, null, 2)}\n`,
  );
}
