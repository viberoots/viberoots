import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";

test("matching markers only skip after the committed final path is probed", async () => {
  const main = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const marker = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "utf8",
  );
  assert.match(
    main,
    /if \(markerMatches && !force\) \{[\s\S]*await probe\(\)[\s\S]*await persist\(currentHash\)/,
  );
  assert.match(main, /marker\.hashValue === currentHash/);
  assert.match(main, /acceptedBuilderFingerprints\.includes\(marker\.builderFingerprint\)/);
  assert.match(marker, /importer === "\." \? "root"/);
  assert.doesNotMatch(main, /prepareFinalPnpmStore|skip-root-marker-verify/);
});
