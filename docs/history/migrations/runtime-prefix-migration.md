# Runtime Prefix Migration

The short runtime namespace is now `VBR`/`vbr`. There are no compatibility
aliases for the old `BNX`/`bnx` namespace.

Use these replacements in CI, developer shells, deployment workers, Vault
runbooks, and local `.env` files:

| Old                                   | New                                   |
| ------------------------------------- | ------------------------------------- |
| `BNX_*`                               | `VBR_*`                               |
| `BNX_TEMPLATE_TEST_SCOPE`             | `VBR_TEMPLATE_TEST_SCOPE`             |
| `BNX_DEPLOYMENT_TEST_SCOPE`           | `VBR_DEPLOYMENT_TEST_SCOPE`           |
| `BNX_BUILD_SYSTEM_TESTS`              | `VBR_BUILD_SYSTEM_TESTS`              |
| `BNX_TEST_SEED_*`                     | `VBR_TEST_SEED_*`                     |
| `BNX_VERIFY_*`                        | `VBR_VERIFY_*`                        |
| `BNX_BUCK_REAPER_STATE_FILE`          | `VBR_BUCK_REAPER_STATE_FILE`          |
| `BNX_DEPLOY_*`                        | `VBR_DEPLOY_*`                        |
| `BNX_DEPLOYMENT_*`                    | `VBR_DEPLOYMENT_*`                    |
| `BNX_DEPLOYER_*`                      | `VBR_DEPLOYER_*`                      |
| `BNX_VAULT_*`                         | `VBR_VAULT_*`                         |
| `BNX_CLOUDFLARE_*`                    | `VBR_CLOUDFLARE_*`                    |
| `BNX_KUBERNETES_*`                    | `VBR_KUBERNETES_*`                    |
| `BNX_S3_STATIC_*`                     | `VBR_S3_STATIC_*`                     |
| `BNX_APP_STORE_CONNECT_*`             | `VBR_APP_STORE_CONNECT_*`             |
| `BNX_GOOGLE_PLAY_*`                   | `VBR_GOOGLE_PLAY_*`                   |
| `BNX_NODE_*`                          | `VBR_NODE_*`                          |
| `BNX_NIX_CALL_DEBUG`                  | `VBR_NIX_CALL_DEBUG`                  |
| `BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE` | `VBR_SKIP_REQUIRE_UNIFIED_PNPM_STORE` |
| `BNX_STREAM_NIX_BUILD_LOGS`           | `VBR_STREAM_NIX_BUILD_LOGS`           |
| `BNX_RUNNABLE_*`                      | `VBR_RUNNABLE_*`                      |
| `BNX_MATERIALIZE_TIMEOUT_SEC`         | `VBR_MATERIALIZE_TIMEOUT_SEC`         |
| `BNX_CODEX_*`                         | `VBR_CODEX_*`                         |
| `BNX_CLAUDE_*`                        | `VBR_CLAUDE_*`                        |
| `BNX_AGENT_SAFEHOUSE_*`               | `VBR_AGENT_SAFEHOUSE_*`               |

Command fragments and metadata prefixes moved with the same rule:

| Old                       | New                       |
| ------------------------- | ------------------------- |
| `bnx-nix-outpaths.txt`    | `vbr-nix-outpaths.txt`    |
| `bnx-workspace-root.phys` | `vbr-workspace-root.phys` |
| `bnx-flk-root.*`          | `vbr-flk-root.*`          |
| `bnx-flake-*`             | `vbr-flake-*`             |
| `bnx.*` metadata labels   | `vbr.*` metadata labels   |
| `[BNX-*]` debug tags      | `[VBR-*]` debug tags      |
