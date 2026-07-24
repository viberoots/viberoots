#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const VIBEROOTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const execFileAsync = promisify(execFile);

function sourceFile(rel: string): string {
  return path.join(VIBEROOTS_ROOT, rel);
}

test("standalone command scopes reject every inherited cache-health marker", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  const { stdout } = await execFileAsync("/bin/bash", [
    "-c",
    `export VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1 VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=hostile; . ${JSON.stringify(scope)} standalone; printf '%s:%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"`,
  ]);
  assert.equal(stdout, ":1:\n");
});

test("verified ingress always starts a fresh command-scoped cache decision", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  const { stdout } = await execFileAsync("/bin/bash", [
    "-c",
    `export VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1; . ${JSON.stringify(scope)} verified-ingress; printf '%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE"; unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED; export VBR_NIX_CACHE_HEALTH_APPLIED=1; . ${JSON.stringify(scope)} verified-ingress; printf '%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE"`,
  ]);
  assert.equal(stdout, ":1\n:1\n");
});

test("every command front door selects its fixed cache-scope authority", async () => {
  const ingressCommands = ["build", "p"];
  const standaloneCommands = ["install-deps", "u", "v", "verify"];
  for (const command of ingressCommands) {
    const source = await fsp.readFile(sourceFile(`build-tools/tools/bin/${command}`), "utf8");
    assert.match(source, /cache-health-command-scope\.sh" verified-ingress/);
    assert.ok(
      source.indexOf("artifact_ingress_reexec_with_devshell") <
        source.indexOf("cache-health-command-scope.sh"),
    );
    assert.ok(
      source.indexOf("cache-health-command-scope.sh") <
        source.indexOf("artifact_ingress_clear_selectors"),
    );
    assert.ok(
      source.indexOf("artifact_ingress_trust_devshell_baseline") <
        source.indexOf("artifact_ingress_refresh_nix_cache_health"),
    );
    assert.ok(
      source.indexOf("artifact_ingress_refresh_nix_cache_health") <
        source.indexOf("artifact_ingress_publish_reviewed_nix_cache_config"),
    );
    assert.ok(
      source.indexOf("artifact_ingress_publish_reviewed_nix_cache_config") <
        source.indexOf("artifact_ingress_restore_or_remove_selectors"),
    );
  }
  for (const command of standaloneCommands) {
    const source = await fsp.readFile(sourceFile(`build-tools/tools/bin/${command}`), "utf8");
    assert.match(source, /cache-health-command-scope\.sh" standalone/);
    assert.doesNotMatch(source, /cache-health-command-scope\.sh" verified-ingress/);
  }
});

test("cache scope rejects missing or caller-controlled source modes", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  for (const mode of ["", "hostile"]) {
    const result = await execFileAsync("/bin/bash", [
      "-c",
      `. ${JSON.stringify(scope)} ${JSON.stringify(mode)}`,
    ]).then(
      () => ({ status: 0 }),
      (error: { code?: number }) => ({ status: error.code }),
    );
    assert.equal(result.status, 64);
  }
});

test("shell cache health publishes exact full config on success and nothing on failure", async () => {
  const devshell = sourceFile("build-tools/tools/bin/devshell.sh");
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cache-health-shell-parity-"));
  try {
    const bin = path.join(root, "bin");
    await fsp.mkdir(bin);
    await fsp.writeFile(
      path.join(bin, "nix"),
      '#!/usr/bin/env bash\n[[ "${TEST_NIX_CONFIG_STATUS:-0}" == 0 ]] || exit "$TEST_NIX_CONFIG_STATUS"\nprintf "%s\\n" "${TEST_EFFECTIVE_NIX_CONFIG:-}"\n',
      { mode: 0o755 },
    );
    await fsp.writeFile(path.join(bin, "curl"), "#!/usr/bin/env bash\nexit 22\n", {
      mode: 0o755,
    });
    const full = "experimental-features = nix-command flakes\nbuilders =";
    for (const effective of ["", "builders ="]) {
      const { stdout } = await execFileAsync("/bin/bash", [
        "-c",
        `. "$1"; export PATH="$2:/usr/bin:/bin" NIX_CONFIG="$3" TEST_EFFECTIVE_NIX_CONFIG="$4" VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; env_apply_nix_cache_health; printf '%s\\036%s' "$VBR_NIX_CACHE_HEALTH_APPLIED" "$VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG"`,
        "cache-health-success",
        devshell,
        bin,
        full,
        effective,
      ]);
      assert.equal(stdout, `1\u001e${full}`);
    }

    for (const setup of [
      'export VBR_NIX_CACHE_POLICY=off PATH="$2:/usr/bin:/bin"',
      'export VBR_NIX_CACHE_POLICY=auto PATH="/usr/bin:/bin"',
    ]) {
      const { stdout } = await execFileAsync("/bin/bash", [
        "-c",
        `. "$1"; export NIX_CONFIG="$3"; ${setup}; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; env_apply_nix_cache_health; printf '%s:%s' "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG+x}"`,
        "cache-health-unreviewed",
        devshell,
        bin,
        full,
      ]);
      assert.equal(stdout, ":");
    }

    const failure = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:/usr/bin:/bin" NIX_CONFIG="$3" TEST_EFFECTIVE_NIX_CONFIG='substituters = https://cache.example' VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; env_apply_nix_cache_health >/dev/null 2>&1 || :; printf '%s:%s' "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG+x}"`,
      "cache-health-failure",
      devshell,
      bin,
      full,
    ]);
    assert.equal(failure.stdout, ":");

    const configFailure = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:/usr/bin:/bin" NIX_CONFIG="$3" TEST_NIX_CONFIG_STATUS=42 VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health >/dev/null 2>&1; status=$?; set -e; printf '%s:%s:%s' "$status" "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG+x}"`,
      "cache-health-config-failure",
      devshell,
      bin,
      full,
    ]);
    assert.equal(configFailure.stdout, "1::");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
