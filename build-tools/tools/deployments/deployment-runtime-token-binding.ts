#!/usr/bin/env zx-wrapper
import { readProjectConfigSync } from "./project-config";

type RuntimeHostBinding = {
  kind?: unknown;
  name?: unknown;
};

export function resolveRuntimeTokenBinding(opts: {
  tokenRef: string;
  workspaceRoot?: string;
  env: NodeJS.ProcessEnv;
}): string {
  const parsed = parseRuntimeTokenRef(opts.tokenRef);
  const loaded = readProjectConfigSync(opts.workspaceRoot || process.cwd());
  const host = runtimeHost(loaded.config.runtimeHosts, parsed.host);
  const binding = runtimeBinding(host, parsed.host, parsed.binding);
  if (binding.kind !== "env") {
    throw new Error(
      `runtime control-plane token binding ${parsed.host}/${parsed.binding} must use kind "env"`,
    );
  }
  if (typeof binding.name !== "string" || !binding.name.trim()) {
    throw new Error(
      `runtime control-plane token binding ${parsed.host}/${parsed.binding} is missing env name`,
    );
  }
  const envName = binding.name.trim();
  const token = String(opts.env[envName] || "").trim();
  if (!token) throw new Error(`runtime control-plane token binding is unset: ${envName}`);
  return token;
}

function parseRuntimeTokenRef(tokenRef: string) {
  const body = tokenRef.slice("runtime://".length);
  const [host, ...bindingParts] = body.split("/").filter(Boolean);
  const binding = bindingParts.join("/");
  if (!host || !binding) {
    throw new Error("runtime controlPlaneTokenRef must be runtime://<host>/<binding>");
  }
  return { host, binding };
}

function runtimeHost(runtimeHosts: unknown, name: string): Record<string, unknown> {
  if (!runtimeHosts || typeof runtimeHosts !== "object" || Array.isArray(runtimeHosts)) {
    throw new Error(`runtime control-plane token binding references missing runtimeHost ${name}`);
  }
  const host = (runtimeHosts as Record<string, unknown>)[name];
  if (!host || typeof host !== "object" || Array.isArray(host)) {
    throw new Error(`runtime control-plane token binding references missing runtimeHost ${name}`);
  }
  return host as Record<string, unknown>;
}

function runtimeBinding(
  host: Record<string, unknown>,
  hostName: string,
  bindingName: string,
): RuntimeHostBinding {
  const bindings = host.bindings;
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    throw new Error(`runtimeHost ${hostName} has no bindings for control-plane token refs`);
  }
  const binding = (bindings as Record<string, unknown>)[bindingName];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error(
      `runtime control-plane token binding references missing binding ${hostName}/${bindingName}`,
    );
  }
  return binding as RuntimeHostBinding;
}
