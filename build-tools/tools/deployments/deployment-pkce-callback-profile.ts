#!/usr/bin/env zx-wrapper
import net from "node:net";

export type PkceCallbackMode = "loopback" | "public_host";
export type PkceCallbackScheme = "http" | "https";

export type DeploymentPkceCallbackProfileInput = {
  mode?: string | undefined;
  externalScheme?: string | undefined;
  externalHost?: string | undefined;
  externalPort?: string | number | undefined;
  externalPath?: string | undefined;
  bindHost?: string | undefined;
  bindPort?: string | number | undefined;
  bindPath?: string | undefined;
  openFirewall?: string | boolean | undefined;
};

export type DeploymentPkceCallbackProfile = {
  mode: PkceCallbackMode;
  externalScheme: PkceCallbackScheme;
  externalHost: string;
  externalPort?: number | undefined;
  externalPath: string;
  bindHost: string;
  bindPort?: number | undefined;
  bindPath: string;
  openFirewall: boolean;
};

export const PKCE_CALLBACK_ENV = {
  mode: "VBR_DEPLOYMENT_PKCE_CALLBACK_MODE",
  externalScheme: "VBR_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_SCHEME",
  externalHost: "VBR_DEPLOYMENT_PKCE_CALLBACK_HOST",
  externalPort: "VBR_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_PORT",
  externalPath: "VBR_DEPLOYMENT_PKCE_CALLBACK_EXTERNAL_PATH",
  bindHost: "VBR_DEPLOYMENT_PKCE_CALLBACK_BIND_HOST",
  bindPort: "VBR_DEPLOYMENT_PKCE_CALLBACK_BIND_PORT",
  bindPath: "VBR_DEPLOYMENT_PKCE_CALLBACK_BIND_PATH",
} as const;

function text(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

export function normalizeCallbackHost(
  value: string | undefined,
  label: string,
): string | undefined {
  const host = text(value);
  if (!host) return undefined;
  if (host.includes("://") || /[/?#\s]/.test(host)) {
    throw new Error(`${label} must be a hostname or address, not a URL`);
  }
  const unbracketed = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (unbracketed.includes(":") && net.isIP(unbracketed) !== 6) {
    throw new Error(`${label} must not include a port`);
  }
  return unbracketed;
}

export function urlHost(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) return host;
  return host.includes(":") ? `[${host}]` : host;
}

function normalizePath(value: string | undefined, label: string): string {
  const path = text(value) || "/oidc/callback";
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error(`${label} must be an absolute path without query or fragment`);
  }
  return path;
}

function normalizePort(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a TCP port between 1 and 65535`);
  }
  return port;
}

function normalizeMode(input: DeploymentPkceCallbackProfileInput): PkceCallbackMode {
  const mode = text(input.mode);
  if (mode === "loopback" || mode === "public_host") return mode;
  if (mode) throw new Error(`PKCE callback mode must be loopback or public_host, got ${mode}`);
  return text(input.externalHost) ? "public_host" : "loopback";
}

function normalizeScheme(value: string | undefined, mode: PkceCallbackMode): PkceCallbackScheme {
  const scheme = text(value) || (mode === "public_host" ? "https" : "http");
  if (scheme === "http" || scheme === "https") return scheme;
  throw new Error(`PKCE callback external_scheme must be http or https, got ${scheme}`);
}

function defaultBindHost(mode: PkceCallbackMode, externalHost: string): string {
  if (mode === "public_host") return "127.0.0.1";
  if (externalHost === "::1") return "::1";
  return "127.0.0.1";
}

export function normalizeDeploymentPkceCallbackProfile(
  input: DeploymentPkceCallbackProfileInput = {},
): DeploymentPkceCallbackProfile {
  const mode = normalizeMode(input);
  const externalScheme = normalizeScheme(input.externalScheme, mode);
  const externalHost =
    normalizeCallbackHost(input.externalHost, "PKCE callback external_host") || "127.0.0.1";
  const bindHost =
    normalizeCallbackHost(input.bindHost, "PKCE callback bind_host") ||
    defaultBindHost(mode, externalHost);
  const externalPort = normalizePort(input.externalPort, "PKCE callback external_port");
  const bindPort = normalizePort(input.bindPort, "PKCE callback bind_port");
  if (mode === "public_host" && !bindPort) {
    throw new Error("PKCE public_host callback requires bind_port before printing a login URL");
  }
  if (mode === "public_host" && externalScheme === "http" && !externalPort) {
    throw new Error("PKCE public_host callback with http requires external_port");
  }
  return {
    mode,
    externalScheme,
    externalHost,
    ...(externalPort ? { externalPort } : {}),
    externalPath: normalizePath(input.externalPath, "PKCE callback external_path"),
    bindHost,
    ...(bindPort ? { bindPort } : {}),
    bindPath: normalizePath(input.bindPath, "PKCE callback bind_path"),
    openFirewall: input.openFirewall === true || input.openFirewall === "true",
  };
}

function hasInput(input: DeploymentPkceCallbackProfileInput | undefined): boolean {
  return !!input && Object.values(input).some((value) => text(value) !== undefined);
}

function compactInput(
  input: DeploymentPkceCallbackProfileInput,
): DeploymentPkceCallbackProfileInput | undefined {
  const entries = Object.entries(input).filter(([, value]) => text(value) !== undefined);
  return entries.length > 0
    ? (Object.fromEntries(entries) as DeploymentPkceCallbackProfileInput)
    : undefined;
}

export function pkceCallbackProfileInputFromEnv(
  env: NodeJS.ProcessEnv,
): DeploymentPkceCallbackProfileInput | undefined {
  const input = {
    mode: env[PKCE_CALLBACK_ENV.mode],
    externalScheme: env[PKCE_CALLBACK_ENV.externalScheme],
    externalHost: env[PKCE_CALLBACK_ENV.externalHost],
    externalPort: env[PKCE_CALLBACK_ENV.externalPort],
    externalPath: env[PKCE_CALLBACK_ENV.externalPath],
    bindHost: env[PKCE_CALLBACK_ENV.bindHost],
    bindPort: env[PKCE_CALLBACK_ENV.bindPort],
    bindPath: env[PKCE_CALLBACK_ENV.bindPath],
  };
  return compactInput(input);
}

export function resolveDeploymentPkceCallbackProfile(opts: {
  inputs?: DeploymentPkceCallbackProfileInput | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  metadata?: DeploymentPkceCallbackProfileInput | undefined;
}): DeploymentPkceCallbackProfile {
  const envInput = pkceCallbackProfileInputFromEnv(opts.env || process.env);
  return normalizeDeploymentPkceCallbackProfile(
    hasInput(opts.inputs) ? opts.inputs : envInput || opts.metadata || { mode: "loopback" },
  );
}

export function readMetadataPkceCallbackProfile(
  raw: Record<string, string>,
): DeploymentPkceCallbackProfileInput | undefined {
  const input = {
    mode: raw.pkce_callback_mode,
    externalScheme: raw.pkce_callback_external_scheme,
    externalHost: raw.pkce_callback_external_host || raw.pkce_callback_host,
    externalPort: raw.pkce_callback_external_port || raw.pkce_callback_port,
    externalPath: raw.pkce_callback_external_path,
    bindHost: raw.pkce_callback_bind_host,
    bindPort: raw.pkce_callback_bind_port,
    bindPath: raw.pkce_callback_bind_path,
    openFirewall: raw.pkce_callback_open_firewall,
  };
  return compactInput(input);
}
