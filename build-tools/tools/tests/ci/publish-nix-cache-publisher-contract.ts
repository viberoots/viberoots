import assert from "node:assert/strict";
import fs from "node:fs";
import type { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

export function registerCachePublisherSecretContract(register: typeof test): void {
  register("publisher secrets are admitted only at the final declared publisher subprocess", () => {
    const publication = fs.readFileSync(
      viberootsSourcePath("build-tools/tools/ci/publish-nix-cache-manifest.ts"),
      "utf8",
    );
    const commands = fs.readFileSync(
      viberootsSourcePath("build-tools/tools/ci/artifact-command.ts"),
      "utf8",
    );
    assert.match(publication, /getFlagStr\("publisher-env-file", ""\)/);
    assert.match(publication, /runDeclaredArtifactPublisher\(\{/);
    assert.ok(
      publication.indexOf("await readPublisherCredentials") >
        publication.indexOf("writeManifest(out, manifest)"),
    );
    assert.doesNotMatch(publication, /dryRun,\s*command/);
    assert.doesNotMatch(
      publication,
      /process\.env\.(?:ATTIC_TOKEN|CACHIX_AUTH_TOKEN|CACHIX_SIGNING_KEY)/,
    );
    assert.match(commands, /declaredStoreExecutable\(opts\.declaredToolPath\)/);
    assert.match(commands, /fs\.realpathSync\(value\)/);
    assert.match(commands, /fs\.constants\.X_OK/);
    assert.match(commands, /env: \{ \.\.\.canonicalEnv, \.\.\.opts\.publisherEnv \}/);
    assert.match(commands, /redactPublisherOutput\(result\.stderr, opts\.publisherEnv\)/);
    const publisher = commands.slice(
      commands.indexOf("export async function runDeclaredArtifactPublisher"),
    );
    const environmentStart = publisher.indexOf("const canonicalEnv = buildArtifactEnvironment");
    const environmentEnd = publisher.indexOf("  });", environmentStart);
    assert.ok(environmentStart > 0 && environmentEnd > environmentStart);
    assert.doesNotMatch(publisher.slice(environmentStart, environmentEnd), /publisherEnv/);
  });
}
