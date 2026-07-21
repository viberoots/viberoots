import fs from "node:fs";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../lib/artifact-nix-policy";

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
  tools: { nix: string };
  storePaths: StorePathEntry[];
};

const SCHEMA = "viberoots.nix-store-materialization.v1";

export function parseMaterializationManifest(input: unknown): NixStoreMaterializationManifest {
  const data = input as Partial<NixStoreMaterializationManifest>;
  if (data?.schemaVersion !== SCHEMA) throw new Error(`manifest schemaVersion must be ${SCHEMA}`);
  requireString(data.sourceRevision, "sourceRevision");
  requireStorePath(data.sourceSnapshot, "sourceSnapshot");
  requireString(data.flakeLockFingerprint, "flakeLockFingerprint");
  requireStorePath(data.tools?.nix, "tools.nix");
  if (data.substituter?.endpointIdentity) {
    requireString(data.substituter.endpointIdentity, "substituter.endpointIdentity");
    if (!REVIEWED_SUBSTITUTERS.includes(data.substituter.endpointIdentity as never)) {
      throw new Error("substituter.endpointIdentity is not a reviewed artifact cache");
    }
  }
  if (!Array.isArray(data.substituter?.trustedPublicKeys)) {
    throw new Error("substituter.trustedPublicKeys must be an array");
  }
  for (const key of data.substituter.trustedPublicKeys) {
    if (!REVIEWED_PUBLIC_KEYS.includes(key as never)) {
      throw new Error("substituter.trustedPublicKeys contains an unreviewed key");
    }
  }
  if (data.substituter.endpointIdentity && data.substituter.trustedPublicKeys.length === 0) {
    throw new Error("reviewed substituter requires at least one reviewed public key");
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

function requireString(value: unknown, name: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
}

function requireStorePath(value: unknown, name: string): void {
  requireString(value, name);
  if (!String(value).startsWith("/nix/store/")) {
    throw new Error(`${name} must be a /nix/store path`);
  }
}

export function redactEndpoint(endpoint: string | undefined): string {
  if (!endpoint) return "";
  return endpoint.replace(/\/\/([^/@]+)@/, "//<redacted>@");
}

function redactKey(key: string): string {
  return key.replace(/:[A-Za-z0-9+/=._-]{8,}$/, ":<redacted>");
}

export function redactCommand(command: string[]): string[] {
  return command.map((part, index) =>
    command[index - 1] === "--option" ? part : redactEndpoint(part),
  );
}
