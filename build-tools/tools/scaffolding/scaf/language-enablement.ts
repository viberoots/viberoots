import path from "node:path";
import fs from "node:fs";

import { exists } from "./fs";

function activeSourceRoot(candidate: string): string | null {
  const root = path.resolve(candidate);
  const nested = path.join(root, "viberoots");
  if (fs.existsSync(path.join(nested, "build-tools", "tools", "scaffolding"))) return nested;
  if (fs.existsSync(path.join(root, "build-tools", "tools", "scaffolding"))) return root;
  return null;
}

function moduleSourceRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
}

function sourceRoot(): string {
  const fromModule = moduleSourceRoot();
  const workspaceRoot = String(
    process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "",
  ).trim();
  if (workspaceRoot) {
    const workspaceViberoots = path.join(path.resolve(workspaceRoot), "viberoots");
    if (path.relative(workspaceViberoots, fromModule).startsWith("..") === false) {
      return fromModule;
    }
  }
  for (const envRoot of [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
  ]) {
    const active = envRoot.trim() ? activeSourceRoot(envRoot) : null;
    if (active) return active;
  }
  return fromModule;
}

function sourcePath(...parts: string[]): string {
  return path.join(sourceRoot(), ...parts);
}

export async function isLanguageEnabled(language: string): Promise<boolean> {
  if (language === "go") {
    const goTpl = sourcePath("build-tools", "tools", "nix", "templates", "go.nix");
    const goDefs = sourcePath("build-tools", "go", "defs.bzl");
    return (await exists(goTpl)) && (await exists(goDefs));
  }
  if (language === "node") {
    const defs = sourcePath("build-tools", "node", "defs.bzl");
    const nodeTplRoot = sourcePath("build-tools", "tools", "scaffolding", "templates", "node");
    const tsTplRoot = sourcePath("build-tools", "tools", "scaffolding", "templates", "ts");
    return (await exists(defs)) && ((await exists(nodeTplRoot)) || (await exists(tsTplRoot)));
  }
  if (language === "ts") {
    return true;
  }
  if (language === "deployment") {
    return await exists(sourcePath("build-tools", "deployments", "defs.bzl"));
  }
  const tplPath = sourcePath("build-tools", "tools", "nix", "templates", `${language}.nix`);
  return await exists(tplPath);
}
