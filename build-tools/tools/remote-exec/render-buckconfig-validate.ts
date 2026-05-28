import path from "node:path";
import {
  supportedBuckConfigKeys,
  type RemoteBuckConfigInput,
  type RemoteBuckFallbackPolicy,
} from "./render-buckconfig-model";

const fallbackPolicies: readonly RemoteBuckFallbackPolicy[] = [
  "strict-remote",
  "hybrid",
  "local-only",
];

const systemPattern = /^(x86_64-linux|aarch64-linux|aarch64-darwin)$/;
const profilePattern = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const instancePattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const grpcEndpointPattern = /^grpcs?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/;
const pathPattern = /^(\$\{?[A-Z][A-Z0-9_]*\}?|\.{0,2}\/|\/|[A-Za-z]:\\)[^\n\r]*$/;
const headerPattern = /^[A-Za-z0-9-]+:\s*\S.*$/;
const envRefPattern = /^\$\{?[A-Z][A-Z0-9_]*\}?$/;
const sensitiveHeaderNamePattern =
  /(^|[-_])(authorization|api[-_]?key|token|secret|password)([-_]|$)/i;
const secretHeaderPattern =
  /:\s*(bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[-_ ]?key|token)[=: ]+[A-Za-z0-9._~+/=-]{12,}|[A-Za-z0-9._~+/=-]{32,})$/i;
const bearerHeaderPattern = /^bearer\s+\S+$/i;

export function validateRemoteBuckConfigInput(input: RemoteBuckConfigInput): void {
  validateOutputDir(input.artifactDir);
  validateEndpoint(input.engineAddress, "engineAddress");
  validateEndpoint(input.casAddress, "casAddress");
  validateEndpoint(input.actionCacheAddress, "actionCacheAddress");
  requireMatch(input.instanceName, instancePattern, "instanceName");
  requireMatch(input.targetSystem, systemPattern, "targetSystem");
  requireMatch(input.targetProfile, profilePattern, "targetProfile");
  if (!fallbackPolicies.includes(input.fallbackPolicy)) {
    throw new Error(`unsupported fallbackPolicy "${input.fallbackPolicy}"`);
  }
  validateOutputDir(input.eventLogReportDir);
  validateAuth(input.auth);
}

export function validateRenderedBuckConfigKeys(configText: string): void {
  let section = "";
  for (const raw of configText.split(/\r?\n/)) {
    const line = raw.trim();
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1] || "";
      if (!(section in supportedBuckConfigKeys)) throw new Error(`unsupported section ${section}`);
      continue;
    }
    const keyMatch = /^([A-Za-z0-9_.-]+)\s*=/.exec(line);
    if (!keyMatch) continue;
    const allowed = new Set<string>(
      supportedBuckConfigKeys[section as keyof typeof supportedBuckConfigKeys] || [],
    );
    if (!allowed.has(keyMatch[1] || "")) {
      throw new Error(`unsupported Buck config key ${section}.${keyMatch[1]}`);
    }
  }
}

function validateAuth(auth: RemoteBuckConfigInput["auth"]): void {
  if (auth.mode === "mtls") {
    for (const [name, value] of Object.entries({
      caCerts: auth.caCerts,
      clientCert: auth.clientCert,
      clientKey: auth.clientKey,
    })) {
      if (/-----BEGIN /.test(value)) throw new Error(`${name} must not contain inline PEM data`);
      requireMatch(value, pathPattern, name);
    }
    return;
  }
  if (auth.mode !== "headers") throw new Error(`unsupported auth mode ${(auth as any).mode}`);
  if (!auth.httpHeaders.length) throw new Error("httpHeaders must not be empty");
  for (const header of auth.httpHeaders) {
    requireMatch(header, headerPattern, "httpHeaders");
    const { name, value } = splitHeader(header);
    const sensitiveName = sensitiveHeaderNamePattern.test(name);
    const sensitiveValue = secretHeaderPattern.test(header) || bearerHeaderPattern.test(value);
    if ((sensitiveName || sensitiveValue) && !envRefPattern.test(value)) {
      throw new Error("httpHeaders must use environment references for bearer/API-key values");
    }
  }
}

function splitHeader(header: string): { name: string; value: string } {
  const index = header.indexOf(":");
  return {
    name: header.slice(0, index).trim(),
    value: header.slice(index + 1).trim(),
  };
}

function validateOutputDir(dir: string): void {
  const resolved = path.resolve(dir);
  if (!dir || dir === "." || dir === path.parse(path.resolve(dir)).root) {
    throw new Error("output directories must be explicit artifact/config directories");
  }
  if (path.basename(resolved) === path.basename(process.cwd())) {
    throw new Error("output directory must not be the repository root");
  }
  const segments = resolved.split(path.sep).map((segment) => segment.toLowerCase());
  if (!segments.some((segment) => /^(buck-out|artifacts?|config)$/.test(segment))) {
    throw new Error("output directories must be explicit artifact/config directories");
  }
}

function validateEndpoint(value: string, name: string): void {
  requireMatch(value, grpcEndpointPattern, name);
}

function requireMatch(value: string, pattern: RegExp, name: string): void {
  if (!pattern.test(value || "")) throw new Error(`invalid ${name}`);
}
