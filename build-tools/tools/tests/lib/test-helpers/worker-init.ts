import "../../../lib/ensure-zx-globals";
import { pathToFileURL } from "node:url";
import { buildToolPath } from "../../../dev/dev-build/paths";

try {
  const zxInit = buildToolPath(process.cwd(), "tools/dev/zx-init.mjs");
  await import(pathToFileURL(zxInit).href);
} catch {}
