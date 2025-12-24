#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import { resolveImporterLocalPatchDir } from "../../patch/lib/importer-local-patch-dir";

test("importer-local patch dir resolution (python): defaults + overrides", () => {
  const root = path.resolve("/repo");

  const repoRootDefault = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: path.join(root),
    lang: "python",
    overridePatchDir: "",
  });
  if (repoRootDefault !== path.join(root, "patches", "python")) {
    console.error("unexpected repo-root default patch dir", { got: repoRootDefault });
    process.exit(2);
  }

  const appDefault = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: path.join(root, "apps", "web"),
    lang: "python",
    overridePatchDir: "",
  });
  if (appDefault !== path.join(root, "apps", "web", "patches", "python")) {
    console.error("unexpected apps/* default patch dir", { got: appDefault });
    process.exit(2);
  }

  const absOverride = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: path.join(root, "apps", "web"),
    lang: "python",
    overridePatchDir: path.resolve("/tmp/custom-patches"),
  });
  if (absOverride !== path.resolve("/tmp/custom-patches")) {
    console.error("unexpected absolute override patch dir", { got: absOverride });
    process.exit(2);
  }

  const relOverride = resolveImporterLocalPatchDir({
    repoRootAbs: root,
    importerDirAbs: path.join(root, "apps", "web"),
    lang: "python",
    overridePatchDir: "some/relative/dir",
  });
  if (relOverride !== path.join(root, "some", "relative", "dir")) {
    console.error("unexpected relative override patch dir", { got: relOverride });
    process.exit(2);
  }
});
