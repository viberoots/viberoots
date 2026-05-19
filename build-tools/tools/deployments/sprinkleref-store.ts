#!/usr/bin/env zx-wrapper
import { SprinkleRefInfisicalStore } from "./sprinkleref-infisical";
import { SprinkleRefMacosKeychainStore } from "./sprinkleref-keychain";
import { SprinkleRefLocalFileStore } from "./sprinkleref-local-file";
import type { SprinkleRefBackendConfig, SprinkleRefStore } from "./sprinkleref-types";

export function createSprinkleRefStore(
  backend: SprinkleRefBackendConfig,
  opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; fetchImpl?: typeof fetch } = {},
): SprinkleRefStore {
  if (backend.backend === "local-file") return new SprinkleRefLocalFileStore(backend.file || "");
  if (backend.backend === "macos-keychain") {
    return new SprinkleRefMacosKeychainStore(backend.service || "", opts.platform);
  }
  if (backend.backend === "infisical") {
    return new SprinkleRefInfisicalStore(backend, opts.env, opts.fetchImpl);
  }
  if (backend.backend === "vault") {
    throw new Error("vault SprinkleRef profile is used by deployment bootstrap, not direct stores");
  }
  throw new Error(`${backend.backend} SprinkleRef backend is read-only in this PR`);
}
