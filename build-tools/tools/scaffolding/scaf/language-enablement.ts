import path from "node:path";

import { exists } from "./fs.ts";

export async function isLanguageEnabled(language: string): Promise<boolean> {
  if (language === "go") {
    const goTpl = path.join("build-tools", "tools", "nix", "templates", "go.nix");
    const goDefs = path.join("go", "defs.bzl");
    return (await exists(goTpl)) && (await exists(goDefs));
  }
  if (language === "node") {
    try {
      const { globby } = await import("fast-glob");
      const locks = await globby(["**/pnpm-lock.yaml"], {
        gitignore: true,
        ignore: ["**/buck-out/**", "**/.tmp/**", "**/node_modules/**"],
      });
      return Array.isArray(locks) && locks.length > 0;
    } catch {
      return false;
    }
  }
  if (language === "ts") {
    return true;
  }
  const tplPath = path.join("build-tools", "tools", "nix", "templates", `${language}.nix`);
  return await exists(tplPath);
}
