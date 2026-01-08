import "zx/globals";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  const zxInit = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");
  await import(pathToFileURL(zxInit).href);
} catch {}
