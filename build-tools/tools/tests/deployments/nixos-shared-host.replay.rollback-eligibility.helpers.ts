#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostDeployment } from "../../deployments/contract.ts";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

export type ReplayPaths = {
  statePath: string;
  hostRoot: string;
  recordsRoot: string;
};

export async function writeReplayArtifact(
  root: string,
  marker: string,
  includeHealthz = true,
): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
  if (includeHealthz) {
    await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
  }
}

export function replaySmokeConnect(port: number) {
  return { protocol: "https:" as const, hostname: "127.0.0.1", port, rejectUnauthorized: false };
}

export function replayPaths(tmp: string): ReplayPaths {
  return {
    statePath: path.join(tmp, "platform-state.json"),
    hostRoot: path.join(tmp, "host"),
    recordsRoot: path.join(tmp, "records"),
  };
}

export function replayDeploymentFixture(): NixosSharedHostDeployment {
  return nixosSharedHostDeploymentFixture({
    runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
  });
}

export function resolveReplaySelection(opts: {
  deployment: NixosSharedHostDeployment;
  recordsRoot: string;
  sourceRunId: string;
  rollback: boolean;
}) {
  return resolveNixosSharedHostReplaySelection(opts);
}
