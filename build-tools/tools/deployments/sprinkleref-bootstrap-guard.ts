#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { resolveSprinkleRefBackend } from "./sprinkleref-config";
import type { SprinkleRefBackendConfig, SprinkleRefConfig } from "./sprinkleref-types";

export type ResolvedSprinkleRefBackend = {
  category: string;
  profile?: string;
  backend: SprinkleRefBackendConfig;
};

export function assertBootstrapCategoryCanWrite(resolved: ResolvedSprinkleRefBackend) {
  if (resolved.category !== "bootstrap") return;
  if (resolved.profile?.startsWith("infisical")) {
    throw new Error(`SprinkleRef bootstrap category must not use an Infisical profile.
Remediate: build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run, then update bootstrap with sprinkleref --resolver-entry --update bootstrap --backend local-file --file .local/infisical/bootstrap/credentials.json --config <resolver-config>`);
  }
  if (resolved.backend.backend === "infisical") {
    throw new Error(`SprinkleRef bootstrap category must not use an Infisical backend.
Remediate: build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run, then update bootstrap with sprinkleref --resolver-entry --update bootstrap --backend local-file --file .local/infisical/bootstrap/credentials.json --config <resolver-config>`);
  }
}

export function resolveBootstrapSprinkleRefBackend(
  config: SprinkleRefConfig,
  category: string,
): ResolvedSprinkleRefBackend {
  try {
    const resolved = resolveSprinkleRefBackend(config, category);
    assertBootstrapCategoryCanWrite(resolved);
    return resolved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      category === "bootstrap" &&
      /SprinkleRef (category bootstrap|profile .* not)/.test(message)
    ) {
      throw new Error(`${message}
${bootstrapResolverRemediation()}`);
    }
    throw error;
  }
}

export async function assertBootstrapResolverConfigExists(configPath: string) {
  try {
    await fs.access(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`SprinkleRef resolver config not found: ${configPath}
${bootstrapResolverRemediation("point SPRINKLEREF_CONFIG at an existing resolver config or ")}`);
  }
}

function bootstrapResolverRemediation(prefix = "") {
  return `Remediate: build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run, then ${prefix}update bootstrap with sprinkleref --resolver-entry --update bootstrap --backend local-file --file .local/infisical/bootstrap/credentials.json --config <resolver-config>`;
}
