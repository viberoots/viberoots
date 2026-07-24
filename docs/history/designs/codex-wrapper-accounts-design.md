# Codex Wrapper Multi-Account Design

Status: design note, not an active operator runbook. It describes the intended multi-account support for the repository's `codex` wrapper and should be checked against current implementation before use.

## Purpose

Support switching between multiple OpenAI accounts (both ChatGPT-account and API-key auth modes) through the repository's `codex` wrapper without hardcoding account identities, without leaking identities into committed source, and without diverging from upstream `codex` CLI semantics.

Both accounts in scope are OpenAI accounts. Bedrock, Azure, and other providers are out of scope for this design.

## Non-Goals

- Replacing or forking upstream `codex` login flows. The wrapper delegates authentication to `codex login`.
- Cross-account synchronization of settings, sessions, or history.
- Server-side account management. All state stays under `$HOME`.
- Per-account isolation of macOS Keychain items. Upstream `codex` uses the login user's keychain; that scope is user-wide, not per-account.
- Renaming accounts through the wrapper. Rename via `mv ~/.codex-accounts/<old> ~/.codex-accounts/<new>` and update the `default` symlink if it pointed at the old name.
- Shell-completion coverage of wrapper-owned flags. `codex completion` reflects only upstream flags.

## OS Scope

The accounts layer (resolution, `--account`, `--list-accounts`, `--remove-account`, guided setup) works on both macOS and Linux without conditionals; it only reads and writes files under `$HOME`.

The existing safehouse (`sandbox-exec`) path is macOS-only. On Linux the wrapper does not enter the safehouse; the account resolution still applies and `CODEX_HOME` still rebinds to the resolved account directory. References to safehouse behavior in this doc apply only on macOS.

## Glossary

- **Account**: an auth identity (an OpenAI account) selected by rebinding `CODEX_HOME` to a per-account directory. Owns `auth.json`, per-account config, sessions, MCP registrations, plugins, and `.codex-global-state.json`.
- **Profile**: an upstream `codex` config overlay selected with `-p, --profile <name>`, which layers `$CODEX_HOME/<name>.config.toml` on top of the base user config. Profiles do not switch auth.
- **Safehouse**: the wrapper's per-invocation macOS sandbox (`sandbox-exec`) with a synthesized `HOME`, denied direct access to the real `$HOME`, and a symlink exposing only the resolved account directory. Not used on Linux.
- **Worktree**: the wrapper's existing feature that re-execs `codex` against a git worktree; independent of accounts.

## Findings

Findings verified by direct inspection during design review; adjust if upstream or the wrapper drift.

- Upstream `codex` (observed on v0.144.x) already exposes `-p, --profile <name>`, which layers `$CODEX_HOME/<name>.config.toml` on top of the base user config. It does not swap authentication credentials. `auth.json` is per-`CODEX_HOME`, not per-profile.
- The existing wrapper (`build-tools/tools/bin/codex`) already honors `CODEX_HOME` and falls back to `$HOME/.codex`. It symlinks that directory into a per-invocation safehouse at `bin/codex:680-714`. No source of hardcoded account identities exists today.
- The wrapper re-injects `CODEX_HOME=$codex_home` into the safehouse environment (bin/codex:727). Any account-selection logic added must run **before** that injection so the resolved path is used, not the caller's inherited value.
- The wrapper's safehouse profile at `bin/codex:588-617` denies broad `$HOME` reads/writes. Nothing in the profile grants outbound network, browser launch, or localhost bind. Sibling accounts under `~/.codex-accounts/` are already denied by the blanket `$HOME` deny; only the resolved account is re-allowed via `--add-dirs="$codex_home"` at line 713. No new profile deny rules are required.
- The wrapper already ships a strict `validate_worktree_name` at `bin/codex:319-325`. Account-name validation follows the same pattern.
- Before this change the wrapper did not invoke a structured account helper or own login locking.
- `~/.codex/auth.json` shape includes:
  - `auth_mode`: `chatgpt` or `apikey`, matching the current upstream persisted schema.
  - For `chatgpt`: `tokens.id_token` is a JWT whose payload contains `email`, `email_verified`, `sub`, `sid`, `exp`. Payload segments are base64url-encoded (`-`/`_` alphabet, no padding).
  - For `apikey`: `OPENAI_API_KEY` populated, no `tokens`.
- The repo standardizes structured logic in TypeScript invoked via `zx-wrapper --import <zx-init.mjs> <target.ts>`, per the `node_ts`/`run_ts` helpers in `bin/devshell.sh:547-593`. The account controller uses that pattern for every invocation so parsing, resolution, filesystem inspection, and lifecycle decisions have one authority. It does not shell out to `jq`, `python3`, or `base64`.
- The wrapper defines `VIBEROOTS_SOURCE_ROOT` at `bin/codex:35` (not `VIBEROOTS_ROOT`, which is only set inside `devshell.sh:env_init_paths`). Any TS-helper invocation from the codex wrapper resolves paths through `VIBEROOTS_SOURCE_ROOT`.
- `build-tools/tools/dev/TARGETS:56-64` uses `filegroup(srcs = glob(["**/*.ts", "**/*.mjs", "**/*.json"]))`; adding `codex-accounts.ts` and any sub-module files under a `codex-accounts/` directory is automatic. The same is true for `build-tools/tools/tests/dev/` for the new `*.test.ts`. No `BUCK`/`TARGETS` edits are required.
- `Buffer` is available as a global in the zx TS context via `zx-init.mjs` importing `zx/globals`; existing files such as `build-tools/tools/dev/evaluation-bundle-dev-overrides.ts:113,141` use `Buffer.from(..., 'hex')` without an explicit `import { Buffer } from 'node:buffer'`.

## Design Decisions

### One account is one directory under a shared root

Account state lives under a dedicated root, one directory per account:

```
~/.codex-accounts/
  <name-1>/{auth.json, config.toml, <name-1>.config.toml, sessions/, mcp/, plugins/, .codex-global-state.json, ...}
  <name-2>/{auth.json, config.toml, <name-2>.config.toml, sessions/, mcp/, plugins/, .codex-global-state.json, ...}
  default -> <name-1>
```

- Directory names are chosen by the user and never appear in committed source or tests.
- `default` is a symlink to the account used when no explicit selector is present.
- Legacy `~/.codex/` remains supported as a final fallback so the wrapper does not break current setups.

### Per-account vs shared state

Everything upstream `codex` writes under `CODEX_HOME` is per-account by construction:

| State                                                         | Location                                                 | Scope                                           |
| ------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| `auth.json`                                                   | `$CODEX_HOME/auth.json`                                  | per-account                                     |
| Base config                                                   | `$CODEX_HOME/config.toml`                                | per-account                                     |
| Profile overlays                                              | `$CODEX_HOME/<profile>.config.toml`                      | per-account                                     |
| Sessions (`resume`, `archive`, `delete`, `fork`, `unarchive`) | under `$CODEX_HOME`                                      | per-account                                     |
| MCP server registrations                                      | `$CODEX_HOME/config.toml` and `$CODEX_HOME/mcp/` if used | per-account                                     |
| Plugins                                                       | under `$CODEX_HOME`                                      | per-account                                     |
| `.codex-global-state.json`                                    | `$CODEX_HOME/.codex-global-state.json`                   | per-account                                     |
| macOS Keychain items written by `codex login`                 | user login keychain                                      | user-wide (accepted, not isolated)              |
| Safehouse XDG cache (`$XDG_CACHE_HOME`, macOS)                | `buck-out/tmp/safehouse-cache/xdg`                       | shared across accounts within one repo checkout |
| Codex binary                                                  | Nix-provided                                             | shared                                          |

The wrapper does not multiplex codex binaries. `codex --account <name> update` upgrades the shared binary; per-account state is unaffected.

### Selection uses a wrapper-owned flag, not `--profile`

Add a new wrapper-owned selector rather than overloading upstream `--profile`.

- Flag: `--account <name>`. Long form only; no short alias. `-A` is currently free in upstream `codex --help` but reserving it would risk future collision with upstream additions.
- Env fallback: `CODEX_ACCOUNT=<name>`.
- The wrapper strips the flag from argv before invoking upstream `codex` so upstream sees an untouched command line.

Rationale:

- `--profile` selects a config overlay; an account is an auth identity. Overloading pins the account name to a config-overlay filename and prevents composing an account with an unrelated config profile.
- Silently reinterpreting `--profile` diverges observed behavior from what `codex --help` documents. A separate flag is honest about the wrapper being an extension.
- Independent flags compose: `codex --account work -p debug …` is unambiguous.
- If upstream changes `--profile` semantics in the future, our layer is unaffected.

### Account-name validation

Account names double as filesystem paths and CLI tokens. Validate strictly to prevent injection or ambiguous behavior:

- Non-empty.
- Matches `^[A-Za-z0-9._-]{1,64}$`. Rejects spaces, `/`, `..`, leading `-`, control characters, and unicode.
- Not `default` (reserved for the symlink name).
- Not `legacy` or `.codex` (reserved for the legacy fallback semantics).

Validation runs when `--account <name>` is parsed, when `CODEX_ACCOUNT` is read, and when `--remove-account <name>` is parsed. Invalid names fail closed with a diagnostic showing the offending name and the accepted pattern.

Validation has one TypeScript authority in `codex-accounts/name.ts`. The Bash wrapper does not
parse or validate account names. The `default` symlink created by guided setup always uses a
validated relative name.

### Argv-stripping algorithm

The wrapper must not misconsume positionals or user-supplied `-c key=value` overrides.

- Scan argv left-to-right, tracking whether we are still in the leading-flag region.
- Recognize wrapper flags — `--account <val>`, `--account=<val>`, `--account-init`, `--remove-account <val>`, `--remove-account=<val>`, `--list-accounts`, `--list-accounts=<val>` — only when they appear in flag position, before any bare positional argument.
- Identify the leading-flag region by consuming upstream option tokens that take values so the wrapper knows what is a value vs. a positional. Value-taking upstream flags observed in v0.144.x: `-c`, `--config`, `-i`, `--image`, `-m`, `--model`, `--local-provider`, `-p`, `--profile`, `-s`, `--sandbox`, `--remote`, `--remote-auth-token-env`, `-C`, `--cd`, `--add-dir`, `-a`, `--ask-for-approval`, `--enable`, `--disable`. Anything else is treated as a positional and ends the flag region. This list must be revisited whenever the pinned upstream version changes.
- Alternate narrower rule if the value-taking list is unavailable: require wrapper flags to appear before any non-flag token. Document the limitation if this fallback is used.
- Treat `--` as end-of-options; do not modify anything after it.
- Never inspect values passed to `-c` / `--config` or after `--`; a user setting `-c account="foo"` is upstream config, not our flag.
- When `--account` or `--remove-account` appears with no value (last token, followed by a token beginning with `-`, or `--account=` / `--remove-account=` with an empty right-hand side), fail closed with a diagnostic; never silently consume the next argument.
- When `--account` (or `--remove-account`) appears twice on the same command line, fail closed. Silent last-wins is too easy to misread.
- `--yes` is wrapper-owned only after `--remove-account` has been recognized. Otherwise it is an
  upstream token and must be preserved.

### Resolution precedence

Highest to lowest:

1. Explicit `--account <name>` on the command line.
2. Explicit `CODEX_HOME` in the environment. If a caller already set `CODEX_HOME`, honor it verbatim without further resolution; the caller is asserting authority. This step must run **before** the safehouse re-injection at `bin/codex:727` so caller intent survives.
3. `CODEX_ACCOUNT` in the environment.
4. `~/.codex-accounts/default` symlink target, when it canonically resolves to a direct account
   directory with usable recognized authentication or a regular `config.toml`.
5. Legacy `~/.codex/` directory.

Only the first matching source is used. If none match, the wrapper fails closed with a message suggesting either `codex --account <name> login` or exporting `CODEX_HOME`.

An explicitly empty account selector is an argument error. `--account ""`, `--account=`, and an
explicitly exported empty `CODEX_ACCOUNT` fail closed with exit 2. An unset selector remains absent.
This rule prevents a misspelled or empty higher-precedence selector from silently selecting another
identity.

Broken or ambiguous states are handled explicitly:

- Step 4 accepts only a symlink whose target is one validated relative account name. Its canonical
  directory must be a direct child of the canonical account root. Absolute targets, traversal,
  invalid names, dangling links, account-root symlinks, and account symlinks that resolve outside
  the root are rejected with an advisory before falling through.
- Named selection validates the account root itself even when the account directory is missing.
  Initialization creates a real account root and direct child, then revalidates both; a symlinked
  account root can never redirect account creation.
- A default target is stateful only when it has a usable recognized `auth.json` record or a regular
  `config.toml`. Mere `auth.json` existence is not sufficient.
- If step 5 (`~/.codex/`) and the resolved default have distinct usable ChatGPT records with
  different email claims, emit a one-time warning and prefer the default. The resolver calls the
  shared TypeScript `accountEmail(...)` authority used by the `email` helper. Bash never reads
  `auth.json`, decodes JWTs, or compares identities.
- If `~/.codex-accounts/` exists but is empty (partial migration), skip to step 5 with a stderr advisory suggesting `codex --account <name> login`.
- If `~/.codex` is a symlink, treat its target as the legacy directory but never `mv` a symlink during migration; instruct the operator to migrate the symlink target manually.

Resolution runs pre-safehouse (before macOS `sandbox-exec` is invoked), so reading both `~/.codex/auth.json` and the default target's `auth.json` for the conflict check requires no sandbox exemption.

When both `--account` and a distinct `CODEX_HOME` are supplied, `--account` wins per precedence and the wrapper emits a one-time stderr note that `CODEX_HOME` is being overridden. This prevents silent confusion when a shell has an inherited `CODEX_HOME` that no longer matches the operator's intent.

### Unknown account names trigger guided setup

The same initialization lifecycle applies when the selected name came from `--account` or
`CODEX_ACCOUNT`. If the resolved account directory does not exist:

- **Interactive stdin+stdout (both TTYs) and `VBR_CODEX_NONINTERACTIVE` unset**: prompt

  > Account `<name>` doesn't exist under `~/.codex-accounts/`. Create it? [y/N]

  The default is `N` so an accidental typo (`--acount alise`) cancels rather than creating a stray directory. On `y`, the wrapper:
  1. Creates the directory.
  2. Optionally copies `default/config.toml` as a starting point when a default exists.
  3. Runs `codex --account <name> login` **outside the safehouse**, invoking `$real_codex` directly with only `CODEX_HOME=~/.codex-accounts/<name>` set. Login must run outside the safehouse because OAuth PKCE needs to bind a local port, open a host browser, and reach `auth.openai.com`, none of which the safehouse profile permits.
  4. On login success, re-executes a non-login original command exactly once so safehouse setup
     restarts cleanly.
  5. On login failure, deletes the newly created directory to avoid leaving an empty stray entry, and reports the failure with the exit code from `codex login`.

- **Non-interactive (either TTY is missing or `VBR_CODEX_NONINTERACTIVE=1`)**: fail closed with a clear diagnostic. Provide two escape hatches so automation stays predictable:
  - `--account-init` on the command line, or
  - `CODEX_ACCOUNT_INIT=1` in the environment.

  These skip the confirmation prompt but still require the underlying `codex login` to succeed. Cleanup on failure is identical to the interactive path.

TTY detection uses `[ -t 0 ] && [ -t 1 ]` combined with the `VBR_CODEX_NONINTERACTIVE` override so IDE/cmux contexts with mixed stdio can force non-interactive mode explicitly.

### First-account nicety

After successfully creating the first account, if `~/.codex-accounts/default` does not yet exist, prompt (interactive only):

> Set `<name>` as the default account (no `--account` flag)? [y/N]

On `y`, create the symlink with a relative target (`ln -s <name> ~/.codex-accounts/default`). Relative targets keep the reverse-migration recipe simple.

### Idempotence

- If the account directory exists but its structured authentication state is missing, empty,
  corrupt, unsupported, or incomplete, skip the create prompt and use the outside-safehouse login
  path.
- `apikey` state is usable only with a non-empty `OPENAI_API_KEY`. `chatgpt` state is usable only
  with a decodable `id_token` payload and a non-empty access or refresh token. Expired ID tokens
  remain usable when refresh state is present.
- If the account has usable state, proceed without touching auth.
- An original `login` command is itself the one outside-safehouse login invocation. Successful
  direct login exits with upstream's status and is never re-executed.
- If the wrapper is already running inside an active Safehouse, direct or guided login fails closed
  with exit 77 and instructs the operator to rerun from the host dev shell. Avoiding a second
  Safehouse layer is not equivalent to escaping an existing sandbox.

### Concurrent invocations

Two concurrent `codex --account <same-name> login` runs could corrupt `auth.json`. The TypeScript
lifecycle prevents this with an `mkdir`-based lock:

- Before invoking `codex login`, attempt `mkdir "$codex_home/.login.lock"`. On success, register a trap to `rmdir` it on exit.
- If `mkdir` fails because the directory exists, fail closed with a diagnostic pointing at the lock path and instructing the operator to remove it if the lock is stale.
- The lock guards only `codex login`. Other subcommands do not take the lock; concurrent read-only usage is expected.

The TypeScript login lifecycle owns lock acquisition and cleanup. It installs direct signal handlers
and removes the exact lock path in `finally`; Bash does not interpolate a cleanup command.

**Caveat**: `mkdir` is atomic on local APFS, ext4, xfs, btrfs. It is not reliably atomic on NFSv3 or SMB. Operators whose `$HOME` lives on a network mount must accept a small race window. The wrapper does not fall back to `flock` because `flock` semantics also vary across NFS versions; if this becomes a problem, revisit.

### Listing accounts

Add `--list-accounts` (and `--list-accounts=json` for scripting).

`--list-accounts` runs **pre-safehouse** (same phase as guided login and `--remove-account`). The safehouse deny profile therefore does not apply and the wrapper can read `~/.codex-accounts/` and `~/.codex/` directly.

Split of responsibility:

- **Bash wrapper**: locates the reviewed helper and managed upstream binary, invokes the helper, and
  decodes its NUL-delimited execution plan. It does not parse account flags, inspect account
  filesystems, read JSON, or make lifecycle decisions.
- **TS helper**: parses account-owned argv, resolves the canonical account, inspects structured auth,
  performs wrapper-owned list/remove/login operations, and formats output.

For a normal invocation the helper emits a NUL-delimited plan containing the resolved `CODEX_HOME`,
stripped upstream argv, and any account prefix needed for a worktree re-exec. NUL transport handles
every legal filesystem path without shell quoting or regex parsing.

Invocation shape (mirroring `run_ts "../dev/dev-build.ts" …`):

```
zx-wrapper --import "${VIBEROOTS_SOURCE_ROOT}/build-tools/tools/dev/zx-init.mjs" \
  "${VIBEROOTS_SOURCE_ROOT}/build-tools/tools/dev/codex-accounts.ts" \
  list \
  --root "$codex_accounts_root" \
  --legacy-root "$HOME/.codex" \
  --current "$resolved_account_path" \
  --format text
```

`--format json` produces the JSON variant. No separate PATH lookup for `jq`, `python3`, or `base64` is required.

Text output columns: `NAME`, `AUTH`, `EMAIL`, `DEFAULT`.

Legacy `~/.codex/` is always shown when it exists (as a directory or a symlink to one), labeled `legacy` in the NAME column. Its `DEFAULT` marker is set when precedence actually resolves to it (i.e., no `~/.codex-accounts/default` symlink is usable, no explicit selector was supplied). When both `~/.codex-accounts/` and `~/.codex/` exist, the legacy row appears at the end.

Example:

```
NAME         AUTH        EMAIL                        DEFAULT
alice        chatgpt     alice@example.com            *
work         chatgpt     alice.j@work.example.com
scratch      api-key     (api key)
research     (none)      not logged in
legacy       chatgpt     old-email@example.com
```

Extraction rules (implemented in the TS helper):

- Enumerate account directories under `--root` (skipping the `default` symlink itself).
- If `--legacy-root` exists and is a directory (following symlinks once), append a row with `NAME=legacy` and the same extraction rules applied to `${legacy-root}/auth.json`.
- Read `auth.json` with `fs.readFile` + `JSON.parse`.
- `auth_mode` gives `chatgpt`, `apikey`, or empty.
- For `chatgpt`: split `tokens.id_token` on `.`, take the second segment, base64url-decode with `Buffer.from(seg.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8')`, `JSON.parse` the payload, and read `email` and `exp`. If `exp` is in the past, suffix the email with `(expired)`.
- For `apikey`: print `(api key)`; never print the key itself.
- Missing or empty `auth.json`: `not logged in`.
- Any exception during read or decode is caught per-account inside the TS helper; the offending row degrades to `not logged in` and the rest of the list renders normally.
- `DEFAULT` is `*` when the row's canonical path matches the controller's resolved path. The same
  TypeScript resolver supplies selection and listing state.

**How `--current` is computed**: even for `--list-accounts` invoked without `--account`, the
TypeScript controller runs the full resolution precedence before listing. Cases:

- If precedence resolves to `~/.codex-accounts/<name>`, pass `--current "$HOME/.codex-accounts/<name>"`. The `<name>` row is starred.
- If precedence resolves to legacy `~/.codex/`, pass `--current "$HOME/.codex"`. The `legacy` row is starred.
- If precedence resolves nothing (empty precedence chain), omit `--current`. No row is starred.

The TypeScript resolver and listing helper both use `fs.realpath`. There is no Bash or Python
canonicalization fallback.

JSON output shape:

```json
[
  {
    "name": "alice",
    "auth": "chatgpt",
    "email": "alice@example.com",
    "default": true,
    "expired": false
  },
  {
    "name": "work",
    "auth": "chatgpt",
    "email": "alice.j@work.example.com",
    "default": false,
    "expired": false
  },
  { "name": "scratch", "auth": "api-key", "email": null, "default": false, "expired": false },
  { "name": "research", "auth": null, "email": null, "default": false, "expired": null },
  {
    "name": "legacy",
    "auth": "chatgpt",
    "email": "old-email@example.com",
    "default": false,
    "expired": false
  }
]
```

The `legacy` row is present only when `~/.codex/` exists. Its `name` field is always the literal string `"legacy"` — the wrapper reserves that name (see §Account-name validation) so it cannot collide with a user-chosen account.

The command is read-only; it never contacts the network. It only reads files under `~/.codex-accounts/`.

**Caveat**: `--list-accounts` reading `exp` locally is offline. Any non-list subcommand run against an account whose `id_token.exp` is past _may_ transparently refresh via `auth.openai.com` using the stored refresh token, depending on upstream behavior. `(expired)` in the list therefore means "the token has expired; the next real call may refresh," not "the account is unusable." This claim is unverified against upstream documentation; treat as an operator hint, not a contract.

### Removing accounts

Add `--remove-account <name>` to delete an account cleanly. Like `--list-accounts`, this path runs **pre-safehouse**.

The TypeScript removal lifecycle is the single removal authority. It performs validation, canonical
containment checks, default and lock guards, confirmation, and deletion. Bash never receives or
deletes an account path.

Behavior:

1. Validate `<name>` per §Account-name validation.
2. Resolve the named account through the canonical TypeScript containment authority.
3. If the account does not exist: refuse with the exemplar diagnostic pointing at `--list-accounts`.
4. If the account is the default: refuse with the exemplar diagnostic instructing the operator to re-point or remove the `default` symlink first.
5. If the account has a login lock: refuse with the exemplar diagnostic pointing at the lock path.
6. Otherwise proceed:
   - Interactive stdin+stdout with `VBR_CODEX_NONINTERACTIVE` unset: prompt

     > Remove account `<name>` and all its state (auth, config, sessions, MCP, plugins) under `~/.codex-accounts/<name>`? [y/N]

     Default is `N`.

   - Non-interactive: fail closed unless `--yes` (or `CODEX_ACCOUNT_REMOVE_YES=1`) is provided.

7. On confirmed removal, the TypeScript lifecycle removes that exact canonical directory. Do not
   run `codex logout` first; removal does not touch the macOS Keychain implicitly.
8. On success, print a single line naming the removed account and its former path. Do not enter safehouse; do not run any other codex subcommand in the same invocation.

The wrapper never removes the legacy `~/.codex/` directory; it is out of scope for `--remove-account`.

### TS helper structure

`build-tools/tools/dev/codex-accounts.ts` is the helper entrypoint. To stay within the repo's 250-line-per-file cap and match the split precedent set by `langs-diagnose.ts` + `langs-diagnose/*.ts` and `analyze-verify-timing.ts` + `analyze-verify-timing-helpers.ts`, the helper is split as follows:

```
build-tools/tools/dev/
  codex-accounts.ts             # entry: CLI dispatch, exit codes
  codex-accounts/
    prepare.ts                  # wrapper coordinator
    arguments.ts                # wrapper-owned argv parsing
    resolution.ts               # precedence and canonical containment
    auth-state.ts               # structured usable-auth authority
    login.ts                    # login lifecycle and locking
    removal.ts                  # canonical guarded removal
    transport.ts                # NUL-delimited Bash plan
    version.ts                  # upstream compatibility cache/probe
    list.ts                     # list command (enumerate, format, emit)
    email.ts                    # email command (for legacy-vs-default warning)
    jwt.ts                      # base64url decode + payload extraction
    format.ts                   # text/JSON renderers
    fs-inspect.ts               # symlink resolution, directory enumeration
```

The list and email diagnostic commands use the existing `getFlagStr` helper from
`../lib/cli`, and the entrypoint uses `runMain` from `../lib/cli-wrap`. The `prepare` command uses
the focused account argv parser because it must preserve upstream tokens exactly and honor `--`.

Helper CLI grammar:

```
codex-accounts.ts list  --root <path> [--legacy-root <path>] [--current <path>] --format text|json
codex-accounts.ts email --root <path>
codex-accounts.ts prepare -- <wrapper argv...>
codex-accounts.ts --help
codex-accounts.ts --version
```

The `email` subcommand and resolver share `accountEmail(...)`. It prints the email claim for usable
ChatGPT state or empty on error; no Bash caller parses authentication state.

Helper exit codes:

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | Success.                                            |
| 2    | Argument error (missing flag, invalid combination). |
| 3    | All provided roots missing or unusable.             |

Semantics of exit 3 for `list`: the helper returns 0 with an empty result set when `--root` is missing/absent but `--legacy-root` exists and is usable (this is the legacy-only case, a valid success). Exit 3 fires only when **all** provided roots are missing or unusable.

Expected lifecycle outcomes use a NUL-delimited structured plan and helper exit `0`; the plan carries
the wrapper exit code when no delegation should occur. The wrapper retains mappings for explicit
helper exits `2` and `3` to wrapper exits `2` and `65`. If the wrapper cannot launch the
helper because `zx-wrapper` is not on PATH, the wrapper exits `69` (unavailable). Any other non-zero
exit from a launched helper (including a crash) becomes wrapper `70` — a reserved code for "helper
launched then crashed" so callers can distinguish it from both the "not entered dev shell" case and
upstream `codex` exits.

The Bash wrapper retains only tool discovery, helper launch/plan decoding, existing worktree
orchestration, Safehouse entry, and final upstream delegation.

### Subcommand behavior

`--account` (and the underlying `CODEX_HOME` rebind) applies uniformly across every upstream
subcommand. The TypeScript controller identifies the upstream command only for the explicit login,
initialization, and top-level introspection lifecycles; every other command is delegated unchanged
after the account resolution plan rebinds `CODEX_HOME`.

| Upstream subcommand                                          | Effect of `--account <name>`                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `codex` (interactive)                                        | Runs against `<name>`'s state.                                                            |
| `codex exec`                                                 | Same.                                                                                     |
| `codex login`                                                | Writes `<name>`'s `auth.json`. Runs outside safehouse (see guided setup).                 |
| `codex logout`                                               | Removes `<name>`'s `auth.json` only. Does not touch other accounts or legacy `~/.codex/`. |
| `codex mcp …`                                                | Reads/writes MCP registrations under `<name>`.                                            |
| `codex plugin …`                                             | Reads/writes plugins under `<name>`.                                                      |
| `codex resume` / `archive` / `delete` / `fork` / `unarchive` | Operates on `<name>`'s sessions.                                                          |
| `codex doctor`                                               | Diagnoses `<name>`.                                                                       |
| `codex sandbox`, `debug`, `apply`, `completion`, `features`  | Reads `<name>`'s config where applicable.                                                 |
| `codex update`                                               | Upgrades the shared binary; per-account state is untouched.                               |

Wrapper-owned subcommands — `--list-accounts` and `--remove-account` — do not enter the safehouse and do not delegate to upstream `codex`.

### Safehouse interaction (macOS)

- No additional sandbox-exec deny rules are needed for sibling account privacy. `write_home_deny_profile` at `bin/codex:588-617` already denies all of `$HOME`; only the resolved account is re-allowed via `--add-dirs="$codex_home"` at line 713. A session running under account A therefore cannot read account B's `auth.json`.
- The safehouse's own `CODEX_HOME` re-injection at `bin/codex:727` must reference the resolved-account path, not `$home_real/.codex`. The account-resolution logic must run _before_ the safehouse code path so this substitution is correct.
- Worktree handling: the wrapper's worktree flag parsing (`bin/codex:800-817`) strips only worktree-owned flags. `--account`, `--account-init`, `--remove-account`, and `--list-accounts` must be recognized alongside the worktree flags so they survive the re-exec.
- `XDG_CACHE_HOME` remains shared across accounts within a single repo checkout because it lives under `buck-out/tmp/safehouse-cache/xdg`. This is accepted; the cache holds no credentials.
- The TypeScript account controller runs **pre-safehouse**, including resolution, list/remove, and
  login lifecycle decisions. The safehouse deny profile therefore does not apply to the helper.
  This keeps the "all filesystem work in TS" rule feasible without inventing sandbox exemptions for
  reads of `~/.codex-accounts/`.

On Linux the safehouse is not entered and no `sandbox-exec` profile applies; `CODEX_HOME` is still set to the resolved-account path.

### Redaction and safety

Redaction rules apply to both the bash wrapper's own output _and_ to every stream the TS helper (`codex-accounts.ts`) emits: stdout, stderr, and any tempfile the helper writes. The wrapper and the helper never print **or log** the following in any stream (stdout, stderr, verify logs, sandbox trace files, wrapper-authored temp files, helper-authored temp files):

- `OPENAI_API_KEY`.
- Any `tokens.*` value.
- Any JWT payload field other than `email` and `exp` (and only `exp` internally for the expiry marker).
- Any content of `.codex-global-state.json` or session logs.

Failures during decode are treated as `not logged in` for that row, never a crash of the list command.

Account names themselves are not secret, but the wrapper must not write account names into any file inside the repository (buck-out, verify logs, generated glue, error snapshots). Diagnostics that need to reference an account name write only to stderr.

### Per-repo defaults without leaking identities

Repositories that want to prefer a specific account set `export CODEX_ACCOUNT=<name>` in a user-owned, gitignored file rather than a committed `.envrc`. As part of implementing this design, add `/.envrc.local` to the repository's root `.gitignore` if it is not already covered. Never store account name preferences in committed repository files.

## Exit-Code Convention

The wrapper distinguishes its own fail-closed paths from upstream exit codes:

| Code  | Meaning                                                                                      |
| ----- | -------------------------------------------------------------------------------------------- |
| 0     | Success (either wrapper-owned command or successful upstream delegation).                    |
| 2     | Argument error (missing value, duplicate `--account`, invalid name, empty selector).         |
| 65    | No account resolved (precedence chain exhausted with no `--account-init`).                   |
| 66    | Unknown account, non-interactive, no init opt-in.                                            |
| 67    | Guided login failed (wrapper-side path; the underlying upstream exit is included in stderr). |
| 69    | `zx-wrapper` unavailable on PATH (dev shell not entered).                                    |
| 70    | TS helper (`codex-accounts.ts`) launched then crashed unexpectedly.                          |
| 75    | Concurrent login lock held.                                                                  |
| 77    | Login or initialization requested from inside an already-active Safehouse.                   |
| 78    | `--remove-account` refused (in use as default, holds `.login.lock/`, or unknown name).       |
| Other | Pass-through from upstream `codex` for delegated subcommands.                                |

These codes match sysexits.h categories where reasonable (usage=64, dataerr=65, noinput=66, unavailable=69, software=70, cantcreat=73, tempfail=75, protocol=76, config=78) so callers scripting against the wrapper can differentiate its errors from upstream's. 69 (unavailable) is distinct from 70 (software) so callers can tell "the dev shell isn't entered" apart from "the helper crashed." The TS helper's own exit codes (0/2/3/4) are documented in §TS helper structure; the bash wrapper maps them into the codes above.

## Diagnostic Messages

Exemplar strings the wrapper emits. Exact wording may adjust in implementation but the shape must match.

- **No account resolved (precedence chain exhausted)**:

  ```
  error: no codex account resolved
    tried: --account, CODEX_HOME, CODEX_ACCOUNT, ~/.codex-accounts/default, ~/.codex/
    run: codex --account <name> login   # to create one
    or:  export CODEX_HOME=/absolute/path
  ```

- **Unknown account, non-interactive, no init opt-in**:

  ```
  error: codex account 'alice' does not exist under ~/.codex-accounts/
    run interactively to create it, or pass --account-init (or set CODEX_ACCOUNT_INIT=1)
  ```

- **`--account-init` opt-in but `codex login` failed**:

  ```
  error: guided login failed for account 'alice' (codex login exit=1)
    removed the empty account directory; run: codex --account alice login
  ```

- **Dangling `~/.codex-accounts/default` symlink**:

  ```
  warn: ~/.codex-accounts/default -> alice, but ~/.codex-accounts/alice does not exist
    falling through to ~/.codex/ (legacy)
    run: ln -sfn <name> ~/.codex-accounts/default   # to fix
  ```

- **Concurrent login lock held**:

  ```
  error: another codex login is in progress (lock: ~/.codex-accounts/alice/.login.lock)
    if no other codex is running, remove the lock: rmdir ~/.codex-accounts/alice/.login.lock
  ```

- **Legacy vs default conflict** (both accounts have distinct `auth.json` email):

  ```
  warn: both ~/.codex-accounts/default (email: a@x.com) and ~/.codex/ (email: b@y.com) hold valid auth
    using ~/.codex-accounts/default per precedence; to switch, pass --account or unset the default symlink
  ```

- **`--account` (or `--remove-account`) with no value**:

  ```
  error: --account requires a name (e.g. --account alice); refusing to consume the next argument
  ```

- **Empty selector**:

  ```
  error: --account requires a non-empty account name
  ```

- **Duplicate `--account`**:

  ```
  error: --account specified more than once; pick one
  ```

- **Invalid account name**:

  ```
  error: invalid account name 'alice/two'; must match ^[A-Za-z0-9._-]{1,64}$ and not be 'default' or 'legacy'
  ```

- **`CODEX_HOME` overridden by `--account`**:

  ```
  warn: --account 'alice' overrides CODEX_HOME=/prev/path (using ~/.codex-accounts/alice)
  ```

- **`--remove-account` refused (default in use)**:

  ```
  error: cannot remove 'alice' while it is the default account
    re-point:  ln -sfn <other> ~/.codex-accounts/default
    or unset:  rm ~/.codex-accounts/default
    then rerun: codex --remove-account alice
  ```

- **`--remove-account` refused (lock present)**:

  ```
  error: cannot remove 'alice' while a login is in progress (lock: ~/.codex-accounts/alice/.login.lock)
    if no other codex is running, remove the lock: rmdir ~/.codex-accounts/alice/.login.lock
  ```

- **`zx-wrapper` unavailable when the TS helper is required** (exit 69):

  ```
  error: the codex account resolver requires zx-wrapper on PATH (not found)
    enter the viberoots dev shell before running codex
  ```

- **TS helper crashed after launch** (exit 70):

  ```
  error: codex-accounts.ts exited abnormally (exit=<n>); see wrapper stderr for the helper output
  ```

## Wrapper `--help` Addendum

The wrapper intercepts `--help`, `-h`, and the bare `help` subcommand form, prints its own section first, then delegates to upstream `codex --help` (or the appropriate subcommand help) so upstream's flag list is preserved verbatim.

Addendum text:

```
Wrapper-owned flags (this repository's codex wrapper):
  --account <name>       Select an OpenAI account (rebinds CODEX_HOME).
  --account-init         Non-interactive: create the account and run `codex login` if missing.
  --list-accounts        List configured accounts (name, auth mode, email, default marker).
  --list-accounts=json   Same, as JSON for scripting.
  --remove-account <n>   Remove an account directory (fails if default or locked).
    --yes                Skip removal confirmation (for automation).

Env fallbacks: CODEX_ACCOUNT=<name>, CODEX_ACCOUNT_INIT=1, CODEX_ACCOUNT_REMOVE_YES=1,
               VBR_CODEX_NONINTERACTIVE=1.
Precedence: --account > CODEX_HOME > CODEX_ACCOUNT > ~/.codex-accounts/default > ~/.codex/.
See: docs/history/designs/codex-wrapper-accounts-design.md
```

## Behavioral Contract Summary

- `codex …` with no selectors → resolves default per precedence table.
- `codex --account <name> …` → uses that account; guided setup on unknown when interactive; fail closed with hint when non-interactive unless `--account-init` or `CODEX_ACCOUNT_INIT=1` is passed.
- `CODEX_ACCOUNT=<name> codex …` → same effect as `--account`, lower precedence than an explicit flag.
- `CODEX_HOME=<path> codex …` → wrapper does not override; caller wins. `--account` combined with `CODEX_HOME` emits an override warning.
- `codex --list-accounts` / `codex --list-accounts=json` → local read-only report.
- `codex --remove-account <name>` → wrapper-only; refuses if default or locked; prompts unless `--yes`.
- `codex -p <profile> …` (with or without `--account`) → forwarded to upstream unchanged; config-overlay behavior stays exactly as upstream documents.
- `codex --account <name> login` → runs outside the safehouse; every other `codex --account <name> …` runs inside the safehouse on macOS.

## Filesystem Layout Summary

```
~/.codex-accounts/                          # single wrapper-owned root
  <name>/                                   # user-chosen name
    auth.json                               # written by `codex login`
    config.toml                             # optional per-account base config
    <name>.config.toml                      # optional upstream --profile overlay
    sessions/                               # upstream-owned session state
    mcp/                                    # optional MCP registrations
    plugins/                                # optional plugins
    .codex-global-state.json                # per-account
    .login.lock/                            # transient, present only during login
  default -> <name>                         # optional symlink; user choice
~/.codex/                                   # legacy fallback, still honored
```

Only the path `~/.codex-accounts/` and the symlink name `default` are wrapper-visible constants. All identities remain user-owned.

## Test Strategy

Add wrapper tests parallel to the existing `codex-wrapper.*.test.ts` suite. Tests must remain name-agnostic:

- Use fixture directory names like `codex-account-a`, `codex-account-b`. No test references "work", "personal", or any other identity a maintainer might actually use.
- Cover:
  - Precedence resolution across all five sources (five distinct fixtures per source).
  - Argv rewriting: `--account`, `--account=<val>`, `--account-init`, `--remove-account`, `--list-accounts`, `--list-accounts=json` stripped before upstream sees the argv; `--profile`, `-c`, `-m`, `-p`, `--enable`, positionals, and tokens after `--` preserved verbatim. Include a case where `--account` appears after `--` and is _not_ consumed.
  - `--account` (and `--remove-account`) with no value → diagnostic, exit 2.
  - Duplicate `--account` → diagnostic, exit 2.
  - Duplicate `--remove-account` → diagnostic, exit 2.
  - Empty selector (`--account ""`, `--account=`, `CODEX_ACCOUNT=""`) → exit 2; no fallback.
  - Invalid account name (space, `/`, `..`, leading `-`, reserved `default`/`legacy`) → diagnostic, exit 2.
  - `--account` override of `CODEX_HOME` → warning emitted, resolution proceeds with `--account`.
  - Non-TTY unknown-account failure diagnostic and exit code (66), both via missing TTY and via `VBR_CODEX_NONINTERACTIVE=1`.
  - Existing and unknown accounts selected through `CODEX_ACCOUNT`, including
    `CODEX_ACCOUNT_INIT=1`, follow the same lifecycle as the lower-precedence CLI equivalent.
  - TTY interactive path fixture: confirmation `N`, confirmation `y`, first-account default prompt.
  - `--account-init` failure path: `codex login` returns non-zero → wrapper removes the newly created empty account directory and exits 67 with the exemplar diagnostic.
  - Re-exec after successful outside-safehouse login uses `exec "$SCRIPT_PATH"` (verified via a trace probe or an argv assertion in the fixture).
  - Direct CLI- and environment-selected `login` run outside Safehouse, invoke upstream exactly
    once, and do not re-execute the original login command.
  - Direct and guided login invoked from an already-active Safehouse fail closed with exit 77 and
    never invoke upstream login.
  - Concurrent login lock: two racing invocations, second gets the lock-held diagnostic and exits 75.
  - `--list-accounts` text and JSON output shapes, including `not logged in`, `(api key)`, and `(expired)` cases with fabricated auth.json fixtures. JWT fixtures use unsigned tokens with synthetic payloads and `exp` timestamps in the past/future. Malformed JWT payload degrades that row to `not logged in`; other rows are unaffected.
  - **TS helper** (`build-tools/tools/dev/codex-accounts.ts` and `codex-accounts/*.ts`) has its own unit tests in `build-tools/tools/tests/dev/codex-accounts.test.ts` covering: `--format text` alignment, `--format json` schema, base64url decode of representative JWT segments (with and without padding), missing/empty/corrupt `auth.json` degradation, `default` symlink resolution via `fs.realpath`, `--current` marker matching, `--legacy-root` inclusion (label `legacy`, `DEFAULT` marker only when resolved fallback), and refusal to emit `OPENAI_API_KEY` or `tokens.*` in either format. Tests run under `node --test` per repo convention (verified against `tests/dev/artifact-entrypoint-admission.test.ts` and similar). They do not shell out to the wrapper; they exercise the helper directly. No `TARGETS`/`BUCK` edits are required because `build-tools/tools/dev/TARGETS` and `build-tools/tools/tests/dev/TARGETS` already glob TypeScript files.
  - `--remove-account` refuses to remove the default account (exit 78), refuses when `.login.lock/` is present (exit 78), and refuses an unknown name (exit 78). On success, the directory is gone and no other subcommand runs.
  - `--remove-account` non-interactive without `--yes` fails closed (exit 2); with `--yes` (or `CODEX_ACCOUNT_REMOVE_YES=1`) proceeds.
  - Removal transport handles account roots whose legal filesystem path contains spaces, quotes,
    and newlines without shell parsing.
  - Redaction: no `OPENAI_API_KEY`, no `tokens.*`, no non-email JWT claims appear in any wrapper-emitted stream, TS-helper-emitted stream, wrapper-authored temp file, or helper-authored temp file. Cover both layers.
  - **Repo-write boundary**: hash a recursive source-tree snapshot, run a representative
    `codex --account <name> …` invocation and `codex --list-accounts`, then compare a fresh
    snapshot. Exclude only known runtime/output roots (`buck-out/**`, `.viberoots/**`, `.git/**`,
    dependency stores, and coverage). This detects newly generated residue as well as changes to
    tracked files.
  - Fallback to legacy `~/.codex/` when neither `~/.codex-accounts/` nor selectors are present.
  - `--list-accounts` legacy visibility: legacy row present when `~/.codex/` exists; labeled `legacy`; `DEFAULT` marker only when legacy is the actually-resolved fallback; absent when `~/.codex/` is missing.
  - `zx-wrapper` unavailable: wrapper account resolution fails closed with exit 69. A helper that
    launches and crashes maps to exit 70.
  - Dangling `~/.codex-accounts/default` symlink: falls through to legacy with the exemplar advisory.
  - Absolute external, traversal, invalid-name, state-less, corrupt-auth-only, and escaping-account
    default targets never grant account or Safehouse access and fall through with an advisory.
  - Unknown-account initialization through a symlinked account root fails closed before creating
    external state.
  - Empty `~/.codex-accounts/` directory: falls through to legacy with the partial-migration advisory.
  - Legacy-vs-default email conflict warning.
  - Symlinked `~/.codex` remains a documented manual-migration case; no migration script ships.
  - Safehouse denies sibling account read (macOS only): with two accounts present, a session running as `codex-account-a` cannot read `~/.codex-accounts/codex-account-b/auth.json`. Skip on Linux.
  - Worktree interaction: `--account` survives worktree re-exec at `bin/codex:800-817`.
  - Linux path: the accounts layer resolves and rebinds `CODEX_HOME` correctly with no `sandbox-exec` involved.
  - Upstream version detection accepts reviewed `0.144.x`, warns once and caches an unreviewed
    identity, invalidates on executable mtime change, and does not run for wrapper-only operations.
- Fixtures must never write real credentials. JWT fixtures use unsigned or clearly-fake tokens with synthetic payloads.
- Every account and Safehouse wrapper fixture builds its environment through one sanitizer that removes inherited
  `CODEX_HOME`, all `CODEX_ACCOUNT*`, `CODEX_CLI_PATH`, and all `VBR_CODEX_*` selectors before
  applying explicit synthetic overrides. This includes Safehouse, worktree, and controlling-terminal
  fixtures so a developer's live account state cannot affect a test.
- Existing tests to update in the same change:
  - `codex-wrapper.safehouse-worktree.test.ts:45,77` hardcodes `HOME/.codex`. Update to use the new resolution or run under a fixture `HOME` where `~/.codex-accounts/` is absent so legacy fallback applies unambiguously.
  - Any other test that asserts on `HOME/.codex` literally.

## Migration

For existing users of the wrapper with a single populated `~/.codex/`:

```
mkdir -p ~/.codex-accounts
mv ~/.codex ~/.codex-accounts/<their-chosen-name>
ln -s <their-chosen-name> ~/.codex-accounts/default
```

Notes:

- **If `~/.codex` is a symlink**, do not `mv` it. Migrate the symlink's target directly and update the target path, or leave `~/.codex` in place and rely on legacy fallback.
- **Partial migration** (an empty `~/.codex-accounts/`) leaves the wrapper falling through to legacy `~/.codex/` with a stderr advisory; no user action is required to keep working.
- **Reverse recipe** (rolling back to legacy):

  ```
  # Preserve default account back to legacy location. Assumes a relative `default` symlink target
  # (as created by the first-account nicety). If someone created an absolute symlink manually,
  # use `readlink -f` instead and adjust the `mv` source path.
  DEFAULT="$(readlink ~/.codex-accounts/default)"
  case "$DEFAULT" in
    /*) SRC="$DEFAULT" ;;
    *)  SRC="$HOME/.codex-accounts/$DEFAULT" ;;
  esac
  mv "$SRC" ~/.codex
  rm -rf ~/.codex-accounts
  ```

The legacy fallback keeps unmigrated users working. This design does not force migration; the wrapper transparently supports either layout.

## Upstream Version Compatibility

Observed against codex CLI v0.144.x. The design assumes:

- `-p, --profile <name>` only overlays `<name>.config.toml`. It does not swap `auth.json`.
- `auth.json` schema is `{auth_mode, OPENAI_API_KEY, tokens: {id_token, access_token, refresh_token, account_id}, last_refresh}`.
- `id_token` payload is a JWT with `email`, `exp` claims.
- No upstream flag `--account` exists.

**Detection hook**: the TypeScript controller caches `codex --version` output at
`$XDG_CACHE_HOME/codex-wrapper/version.json` (or `~/.cache/codex-wrapper/version.json`) keyed by the
canonical managed executable path and mtime. It invalidates when the executable changes. On mismatch
with the reviewed `0.144.x` range, it prints one notice for that executable identity. The wrapper
does not auto-defer to upstream.

If any of the assumptions above change, the affected sections of this design must be revisited before shipping.

## Discoverability

- Add a link to this design from `docs/handbook/tooling.md` in the section that describes `codex`. Add the link in the same change that ships the implementation, not later.
- The wrapper's `--help` addendum (above) includes a `See:` line pointing at this file so operators can find the design from the CLI.

## Out of Scope, Noted for Future Work

- A `--doctor-account <name>` flag that scopes upstream `codex doctor` to a specific account.
- Optional account-level aliases (e.g. `~/.codex-accounts/aliases.toml` mapping short names to canonical account names) if the number of accounts grows large.
- Renaming an account through the wrapper. Use `mv ~/.codex-accounts/<old> ~/.codex-accounts/<new>` and update the `default` symlink manually.
- Provider-neutral account support (Bedrock, Azure, self-hosted). This design assumes OpenAI-only accounts.
- Per-account macOS Keychain scoping. Upstream stores keychain items in the login user's default keychain; isolating them per account would require upstream cooperation.
- Extending `codex completion` output to cover wrapper-owned flags. Operators who want completion for `--account` etc. add shell aliases themselves.
