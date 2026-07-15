import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("committed stores refresh ignored markers only after the final path is verified", async () => {
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
  assert.match(
    main,
    /if \(readOnly\) \{\n    if \(!currentHash[\s\S]*await probe\(\)[\s\S]*writeVerifiedMarker/,
  );
  const readOnlyBranch =
    main.match(/if \(readOnly\) \{\n    if \(!currentHash[\s\S]*?\n    return;\n  \}/)?.[0] || "";
  assert.doesNotMatch(
    readOnlyBranch,
    /NIX_PNPM_RECONCILE|updateNodeModulesHashesJson|reconcileFixedPnpmStore/,
  );
  assert.match(marker, /derivationIdentity: string/);
  assert.match(marker, /test\(derivationIdentity\)/);
  assert.match(marker, /\\\.drv\$/);
  assert.match(marker, /importer === "\." \? "root"/);
  assert.doesNotMatch(main, /prepareFinalPnpmStore|skip-root-marker-verify/);
});
