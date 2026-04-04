#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  emptyNixosSharedHostPlatformState,
  type NixosSharedHostPlatformState,
  validateNixosSharedHostPlatformState,
} from "./nixos-shared-host-platform.ts";

type NixosSharedHostDeploymentsDocument = {
  version: 1;
  deployments: NixosSharedHostDeployment[];
};

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source}: failed to parse JSON (${String(error)})`);
  }
}

export async function readNixosSharedHostDeploymentsDocument(
  filePath: string,
): Promise<NixosSharedHostDeploymentsDocument> {
  const raw = await fsp.readFile(filePath, "utf8");
  const parsed = parseJson(raw, filePath) as Partial<NixosSharedHostDeploymentsDocument>;
  if (parsed.version !== 1 || !Array.isArray(parsed.deployments)) {
    throw new Error(`${filePath}: expected { version: 1, deployments: [...] }`);
  }
  return { version: 1, deployments: parsed.deployments };
}

export async function readNixosSharedHostPlatformStateOrEmpty(
  filePath: string,
): Promise<NixosSharedHostPlatformState> {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    const parsed = parseJson(raw, filePath) as Partial<NixosSharedHostPlatformState>;
    if (
      parsed.version !== 1 ||
      parsed.provider !== "nixos-shared-host" ||
      parsed.host !== "nixos-shared-host" ||
      !Array.isArray(parsed.deployments)
    ) {
      throw new Error(`${filePath}: expected a nixos-shared-host platform-state document`);
    }
    const state: NixosSharedHostPlatformState = {
      version: 1,
      provider: "nixos-shared-host",
      host: "nixos-shared-host",
      deployments: parsed.deployments,
    };
    const errors = validateNixosSharedHostPlatformState(state);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    return state;
  } catch (error: any) {
    if (error?.code === "ENOENT") return emptyNixosSharedHostPlatformState();
    throw error;
  }
}

export async function writeJsonDocument(filePath: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}
