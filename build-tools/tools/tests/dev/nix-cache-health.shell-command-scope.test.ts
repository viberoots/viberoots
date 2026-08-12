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
const devshell = path.join(VIBEROOTS_ROOT, "build-tools/tools/bin/devshell.sh");

test("shell cache health publishes exact full config on success and nothing on failure", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cache-health-shell-parity-"));
  try {
    const bin = path.join(root, "bin");
    await fsp.mkdir(bin);
    await fsp.writeFile(
      path.join(bin, "nix"),
      '#!/usr/bin/env bash\n[[ "${TEST_NIX_CONFIG_STATUS:-0}" == 0 ]] || exit "$TEST_NIX_CONFIG_STATUS"\nif [[ " $* " == *" --json "* ]]; then if [[ -n "${TEST_EFFECTIVE_NIX_CONFIG_JSON:-}" ]]; then printf "%s\\n" "$TEST_EFFECTIVE_NIX_CONFIG_JSON"; else printf "{}\\n"; fi; else printf "%s\\n" "${TEST_EFFECTIVE_NIX_CONFIG:-}"; fi\n',
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(bin, "curl"),
      '#!/usr/bin/env bash\nif [[ "${TEST_CURL_REQUIRED_OK:-}" == 1 && ( "$*" == *required.example* || "$*" == *cache.nixos.org* ) ]]; then exit 0; fi\nexit "${TEST_CURL_EXIT:-22}"\n',
      { mode: 0o755 },
    );
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

    const optionalHttp = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:/usr/bin:/bin" NIX_CONFIG="$3" TEST_EFFECTIVE_NIX_CONFIG='extra-substituters = https://optional.example/cache?priority=fixture-secret' VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health; status=$?; set -e; printf '%s:%s\\036%s' "$status" "$VBR_NIX_CACHE_HEALTH_APPLIED" "$VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG"`,
      "cache-health-optional-http",
      devshell,
      bin,
      full,
    ]);
    assert.match(optionalHttp.stdout, /^0:1\u001e/u);
    assert.doesNotMatch(optionalHttp.stdout, /optional\.example|fixture-secret/);
    assert.match(optionalHttp.stderr, /disabled unreachable substituter.*optional\.example\/cache/);
    assert.doesNotMatch(optionalHttp.stderr, /fixture-secret/);

    const optionalTransport = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:/usr/bin:/bin" NIX_CONFIG="$3" TEST_EFFECTIVE_NIX_CONFIG='extra-substituters = https://optional.example/cache' TEST_CURL_EXIT=6 VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health >/dev/null 2>&1; status=$?; set -e; printf '%s:%s' "$status" "$VBR_NIX_CACHE_HEALTH_APPLIED"`,
      "cache-health-optional-transport",
      devshell,
      bin,
      full,
    ]);
    assert.equal(optionalTransport.stdout, "0:1");

    const requiredTransport = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:$3:/usr/bin:/bin" NIX_CONFIG="$4" TEST_EFFECTIVE_NIX_CONFIG='substituters = https://required.example/cache' TEST_EFFECTIVE_NIX_CONFIG_JSON="$5" TEST_CURL_EXIT=6 VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health >/dev/null 2>&1; status=$?; set -e; printf '%s:%s:%s' "$status" "$VBR_NIX_CACHE_HEALTH_APPLIED" "$VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS"`,
      "cache-health-required-transport",
      devshell,
      bin,
      path.dirname(process.execPath),
      full,
      JSON.stringify({
        substituters: {
          defaultValue: ["https://required.example/cache"],
          value: ["https://required.example/cache"],
        },
      }),
    ]);
    assert.equal(requiredTransport.stdout, "0:1:");

    const configRoot = path.join(root, "nix-conf");
    await fsp.mkdir(configRoot);
    await fsp.writeFile(
      path.join(configRoot, "nix.conf"),
      "extra-substituters = https://optional.example/cache\n",
    );
    const flattened =
      "substituters = https://required.example/cache https://optional.example/cache";
    const flattenedJson = JSON.stringify({
      substituters: {
        defaultValue: ["https://required.example/cache"],
        value: ["https://required.example/cache", "https://optional.example/cache"],
      },
    });
    const flattenedOptional = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:$3:/usr/bin:/bin" NIX_CONF_DIR="$4" NIX_USER_CONF_FILES= NIX_CONFIG="$5" TEST_EFFECTIVE_NIX_CONFIG="$6" TEST_EFFECTIVE_NIX_CONFIG_JSON="$7" TEST_CURL_REQUIRED_OK=1 VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health; status=$?; set -e; printf '%s:%s:%s:%s' "$status" "$VBR_NIX_CACHE_HEALTH_APPLIED" "$VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS" "$VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS"`,
      "cache-health-flattened-optional-http",
      devshell,
      bin,
      path.dirname(process.execPath),
      configRoot,
      full,
      flattened,
      flattenedJson,
    ]);
    assert.equal(flattenedOptional.stdout, "0:1:https://required.example/cache:");
    assert.match(
      flattenedOptional.stderr,
      /disabled unreachable substituter.*optional\.example\/cache/,
    );

    const bootstrapRoot = path.join(root, "bootstrap-workspace");
    await Promise.all(
      [".viberoots/current/build-tools/tools/dev", ".viberoots/workspace/prelude"].map((relative) =>
        fsp.mkdir(path.join(bootstrapRoot, relative), { recursive: true }),
      ),
    );
    await fsp.writeFile(path.join(bootstrapRoot, ".buckconfig"), "[repositories]\\n");
    await fsp.writeFile(
      path.join(bootstrapRoot, ".viberoots/current/build-tools/tools/dev/zx-init.mjs"),
      "",
    );
    await fsp.writeFile(
      path.join(bootstrapRoot, ".viberoots/workspace/prelude/prelude.bzl"),
      "# fixture\n",
    );
    await fsp.writeFile(
      path.join(configRoot, "nix.conf"),
      "extra-substituters = https://cache.home.kilty.io/main\n",
    );
    const privateCache = "https://cache.home.kilty.io/main";
    const bootstrap = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:$3:/usr/bin:/bin" NIX_CONF_DIR="$4" NIX_USER_CONF_FILES= NIX_CONFIG="$5" TEST_EFFECTIVE_NIX_CONFIG="$6" TEST_EFFECTIVE_NIX_CONFIG_JSON="$7" TEST_CURL_REQUIRED_OK=1 TEST_CURL_EXIT=6 VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; ensure_buck_prelude "$8"; status=$?; set -e; printf '%s:%s:%s:%s\\036%s' "$status" "$VBR_NIX_CACHE_HEALTH_APPLIED" "$VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS" "$VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS" "$NIX_CONFIG"`,
      "cache-health-private-bootstrap",
      devshell,
      bin,
      path.dirname(process.execPath),
      configRoot,
      full,
      `substituters = https://cache.nixos.org/ ${privateCache}`,
      JSON.stringify({
        substituters: {
          defaultValue: ["https://cache.nixos.org/"],
          value: ["https://cache.nixos.org/", privateCache],
        },
      }),
      bootstrapRoot,
    ]);
    const [bootstrapRoles, bootstrapConfig] = bootstrap.stdout.split("\u001e");
    assert.equal(bootstrapRoles, "0:1:https://cache.nixos.org/:");
    assert.doesNotMatch(bootstrapConfig, /cache\.home\.kilty\.io/u);
    assert.match(
      bootstrap.stderr,
      /disabled unreachable substituter.*cache\.home\.kilty\.io\/main/,
    );

    await fsp.writeFile(
      path.join(configRoot, "nix.conf"),
      "substituters = https://required.example/cache\n",
    );
    const requiredHttp = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:$3:/usr/bin:/bin" NIX_CONF_DIR="$4" NIX_USER_CONF_FILES= NIX_CONFIG="$5" TEST_EFFECTIVE_NIX_CONFIG='substituters = https://required.example/cache' TEST_EFFECTIVE_NIX_CONFIG_JSON="$6" VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health >/dev/null 2>&1; status=$?; set -e; printf '%s:%s' "$status" "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}"`,
      "cache-health-flattened-required-http",
      devshell,
      bin,
      path.dirname(process.execPath),
      configRoot,
      full,
      JSON.stringify({
        substituters: {
          defaultValue: ["https://required.example/cache"],
          value: ["https://required.example/cache"],
        },
      }),
    ]);
    assert.equal(requiredHttp.stdout, "1:");

    await fsp.writeFile(
      path.join(configRoot, "nix.conf"),
      "extra-substituters = https://optional.example/cache\n",
    );
    const mismatchedJsonRoles = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:$3:/usr/bin:/bin" NIX_CONF_DIR="$4" NIX_USER_CONF_FILES= NIX_CONFIG="$5" TEST_EFFECTIVE_NIX_CONFIG="$6" TEST_EFFECTIVE_NIX_CONFIG_JSON='{}' TEST_CURL_REQUIRED_OK=1 VBR_NIX_CACHE_POLICY=auto; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health >/dev/null 2>&1; status=$?; set -e; printf '%s:%s' "$status" "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}"`,
      "cache-health-mismatched-json-roles",
      devshell,
      bin,
      path.dirname(process.execPath),
      configRoot,
      full,
      flattened,
    ]);
    assert.equal(mismatchedJsonRoles.stdout, "1:");

    const strictOptionalHttp = await execFileAsync("/bin/bash", [
      "-c",
      `. "$1"; export PATH="$2:/usr/bin:/bin" NIX_CONFIG="$3" TEST_EFFECTIVE_NIX_CONFIG='extra-substituters = https://optional.example/cache' VBR_NIX_CACHE_POLICY=strict; unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG; set +e; env_apply_nix_cache_health >/dev/null 2>&1; status=$?; set -e; printf '%s:%s' "$status" "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}"`,
      "cache-health-strict-optional-http",
      devshell,
      bin,
      full,
    ]);
    assert.equal(strictOptionalHttp.stdout, "1:");

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
