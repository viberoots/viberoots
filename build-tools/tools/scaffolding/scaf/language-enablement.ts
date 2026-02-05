import path from "node:path";

import { exists } from "./fs.ts";

export async function isLanguageEnabled(language: string): Promise<boolean> {
  if (language === "go") {
    const goTpl = path.join("build-tools", "tools", "nix", "templates", "go.nix");
    const goDefs = path.join("build-tools", "go", "defs.bzl");
    return (await exists(goTpl)) && (await exists(goDefs));
  }
  if (language === "node") {
    const defs = path.join("build-tools", "node", "defs.bzl");
    const tplRoot = path.join("build-tools", "tools", "scaffolding", "templates", "node");
    return (await exists(defs)) && (await exists(tplRoot));
  }
  if (language === "ts") {
    return true;
  }
  const tplPath = path.join("build-tools", "tools", "nix", "templates", `${language}.nix`);
  return await exists(tplPath);
}
