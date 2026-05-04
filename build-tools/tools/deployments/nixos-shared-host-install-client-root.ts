#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr } from "../lib/cli";

export function clientOutputRoot(repoRoot: string): string {
  return path.resolve(
    getFlagStr(
      "output-root",
      path.join(repoRoot, ".local", "deployments", "nixos-shared-host", "clients"),
    ),
  );
}
