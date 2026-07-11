#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { envWithoutSelectedNix } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const bootstrap = viberootsSourcePath("viberoots/bootstrap");
const noNixPath = "/usr/bin:/bin:/usr/sbin:/sbin";

async function noNixPathWithDeveloperTools(): Promise<string> {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-fake-devtools-"));
  await fs.writeFile(
    path.join(bin, "xcode-select"),
    '#!/usr/bin/env bash\nif [[ "$1" == "-p" ]]; then echo /Applications/Xcode.app/Contents/Developer; exit 0; fi\nexit 0\n',
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, "xcrun"),
    '#!/usr/bin/env bash\ncase "$*" in\n  "--find clang") echo /usr/bin/clang ;;\n  "--sdk macosx --show-sdk-path") echo /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk ;;\nesac\nexit 0\n',
    { mode: 0o755 },
  );
  return `${bin}${path.delimiter}${noNixPath}`;
}

test("bootstrap refuses noninteractive Nix install without explicit allow", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-nix-confirm-"));
  const pathWithoutNix = await noNixPathWithDeveloperTools();
  const result = await $({
    env: envWithoutSelectedNix({
      PATH: pathWithoutNix,
      VIBEROOTS_TEST_IGNORE_HOST_PROFILE_NIX: "1",
    }),
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --no-run-install`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(String(result.stderr), /refusing to install Nix without confirmation/);
  assert.match(String(result.stderr), /VBR_ALLOW_NIX_INSTALL=1/);
});

test("bootstrap dry-run distinguishes prompt from explicit Nix install consent", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-nix-dry-run-"));
  const pathWithoutNix = await noNixPathWithDeveloperTools();
  const prompt = await $({
    env: envWithoutSelectedNix({
      PATH: pathWithoutNix,
      VIBEROOTS_TEST_IGNORE_HOST_PROFILE_NIX: "1",
    }),
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --dry-run`.text();
  assert.match(prompt, /allow nix install prompt/);
  assert.match(prompt, /trust nix user prompt/);
  assert.match(prompt, /prompt before installing Nix with the Determinate Nix installer/);
  assert.match(prompt, /prompt before adding the current user to Nix trusted users/);

  const allowed = await $({
    env: envWithoutSelectedNix({
      PATH: pathWithoutNix,
      VIBEROOTS_TEST_IGNORE_HOST_PROFILE_NIX: "1",
      VBR_ALLOW_NIX_INSTALL: "1",
      VBR_TRUST_NIX_USER: "1",
    }),
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --dry-run`.text();
  assert.match(allowed, /allow nix install yes/);
  assert.match(allowed, /trust nix user 1/);
  assert.match(allowed, /install Nix with the Determinate Nix installer/);
  assert.match(allowed, /add the current user to Nix trusted users/);
  assert.doesNotMatch(allowed, /prompt before installing Nix/);
});

test("bootstrap validates Nix trust mode", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "viberoots-nix-trust-mode-"));
  const pathWithoutNix = await noNixPathWithDeveloperTools();
  const result = await $({
    env: envWithoutSelectedNix({
      PATH: pathWithoutNix,
      VBR_TRUST_NIX_USER: "maybe",
      VIBEROOTS_TEST_IGNORE_HOST_PROFILE_NIX: "1",
    }),
  })`/bin/bash ${bootstrap} --workspace-root ${workspace} --dry-run`.nothrow();
  assert.notEqual(result.exitCode, 0);
  assert.match(String(result.stderr), /VBR_TRUST_NIX_USER must be 0, 1, or prompt/);
});
