#!/usr/bin/env zx-wrapper
import path from "node:path";
import { buildSelectedOutPath } from "../dev/run-runnable-graph";
import type { DeploymentTarget } from "./contract";

export function artifactDirFromBuiltOutPath(componentKind: string, outPath: string): string {
  return componentKind === "static-webapp" ? path.join(outPath, "dist") : outPath;
}

export async function buildArtifactDirsByComponentId(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      deployment.components.map(async (component) => {
        const outPath = await buildSelectedOutPath(workspaceRoot, component.target);
        return [component.id, artifactDirFromBuiltOutPath(component.kind, outPath)] as const;
      }),
    ),
  );
}

export function parseComponentArtifactDirs(rawValue: string): Record<string, string> {
  const value = String(rawValue || "").trim();
  if (!value) return {};
  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [componentId, ...pathParts] = entry.split("=");
        if (!componentId || pathParts.length === 0) {
          throw new Error(
            `invalid --component-artifacts entry "${entry}" (expected componentId=/abs/path)`,
          );
        }
        return [componentId.trim(), path.resolve(pathParts.join("=").trim())];
      }),
  );
}
