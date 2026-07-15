import path from "node:path";
import { assertImporterLockfileFresh } from "../../dev/update-pnpm-hash/importer-lockfile";

const lockfile = String(process.argv[2] || "").trim();
if (!lockfile.endsWith("/pnpm-lock.yaml")) {
  throw new Error(`expected importer pnpm lockfile path, got: ${lockfile || "<empty>"}`);
}
await assertImporterLockfileFresh({
  repoRoot: process.cwd(),
  importer: path.dirname(lockfile).split(path.sep).join("/"),
});
console.log(`cold importer metadata is fresh: ${lockfile}`);
