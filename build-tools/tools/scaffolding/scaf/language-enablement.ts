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
    const legacyTplRoot = path.join("build-tools", "tools", "scaffolding", "templates", "node");
    const tsTplRoot = path.join("build-tools", "tools", "scaffolding", "templates", "ts");
    return (await exists(defs)) && ((await exists(legacyTplRoot)) || (await exists(tsTplRoot)));
  }
  if (language === "ts") {
    return true;
  }
  if (language === "deployment") {
    return await exists(path.join("build-tools", "deployments", "defs.bzl"));
  }
  const tplPath = path.join("build-tools", "tools", "nix", "templates", `${language}.nix`);
  return await exists(tplPath);
}
