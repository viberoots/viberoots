#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import type { DeploymentBootstrapMode, DeploymentBootstrapPolicy } from "./contract-types";
import { readStringRecord } from "./contract-extract-shared";

export function readBootstrapPolicy(
  node: GraphNode,
  key: string,
): DeploymentBootstrapPolicy | undefined {
  const bootstrap = readStringRecord(node, key);
  if (Object.keys(bootstrap).length === 0) return undefined;
  const modes: DeploymentBootstrapMode[] = [];
  if (bootstrap.allow_first_install === "true") modes.push("first_install");
  if (bootstrap.allow_offline_recovery === "true") modes.push("offline_recovery");
  return {
    scope: (bootstrap.scope || "") as DeploymentBootstrapPolicy["scope"],
    modes,
  };
}
