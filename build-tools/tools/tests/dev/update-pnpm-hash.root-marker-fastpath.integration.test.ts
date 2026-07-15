import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("matching markers only skip after the committed final path is probed", async () => {
  const main = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  const marker = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/update-pnpm-hash/verified-marker.ts"),
    "utf8",
  );
  assert.match(
    main,
    /if \(markerMetadataMatches && !force\) \{[\s\S]*const realized = await probe\(\)[\s\S]*marker\?\.derivationIdentity === realized\.derivationIdentity[\s\S]*await persist\(currentHash, realized\.derivationIdentity\)/,
  );
  assert.match(main, /marker\.hashValue === currentHash/);
  assert.match(main, /acceptedBuilderFingerprints\.includes\(marker\.builderFingerprint\)/);
  assert.match(main, /marker\?\.derivationIdentity === realized\.derivationIdentity/);
  assert.match(main, /pnpm-store verification is stale.*repair: run u/);
  assert.match(marker, /derivationIdentity: string/);
  assert.match(marker, /test\(derivationIdentity\)/);
  assert.match(marker, /\\\.drv\$/);
  assert.match(marker, /importer === "\." \? "root"/);
  assert.doesNotMatch(main, /prepareFinalPnpmStore|skip-root-marker-verify/);
});
