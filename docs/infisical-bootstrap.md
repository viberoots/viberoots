# Infisical Bootstrap

The canonical operator entrypoint is:

```bash
i
i --yes
i --bootstrap
i --bootstrap --secret-backend vault/default
i --bootstrap --secret-backend infisical/default
i --bootstrap --secret-backend keychain/default
i --without-secrets
i --machine-label <label>
i --infisical-project-name <name>
i --infisical-login-mode browser
i --infisical-login-mode interactive
```

`i` checks the canonical project config pair plus repo and ExampleApp deployment Universal Auth
credentials for this machine. It uses `projects/config/shared.json` for shared resolver/profile
metadata and gitignored `projects/config/local.json` for local sink selection and overrides. It does
not require application secrets such as Cloudflare tokens. Use `--yes` for non-interactive
pre-confirmation, `--without-secrets` for dependency-only automation, and
`--machine-label <label>` when the hostname is not a useful Infisical revocation label. Automation
can also set `INSTALL_DEPS_WITHOUT_SECRETS=1`; non-interactive setup may be explicitly allowed with
`INSTALL_DEPS_SETUP_SECRETS=1`.
Lazy `i` setup defaults to `i --infisical-login-mode browser` so browser SSO is preferred when the
Infisical CLI can open a browser. Infisical CLI browser login does not expose a stable printable
login URL in supported CLI versions. If the browser flow stalls, opens the wrong browser profile, or
is unavailable in the current terminal, press Ctrl-C and rerun with
`i --infisical-login-mode interactive` to use the terminal credential prompt fallback.

Lazy `i` secret readiness is capability-gated by checked-out project configuration or deployment
metadata. A bootstrapped workspace with `projects/config/` prompts for repo bootstrap when the local
resolver config, generated Infisical profile project ids, or repo bootstrap credentials are missing,
even if no deployment packages are checked out yet. Partial clones or minimized workspaces with no
`projects/config/` and no deployment metadata skip Infisical readiness automatically and do not
require `--without-secrets`; full checkouts can still use `--without-secrets` or
`INSTALL_DEPS_WITHOUT_SECRETS=1` as an explicit dependency-only opt-out. When `i` is launched from an
interactive terminal through wrappers such as `direnv exec`, it may read prompts from the controlling
terminal even if the wrapper redirects standard input. True non-interactive automation still fails
closed unless it passes `--yes`, `INSTALL_DEPS_SETUP_SECRETS=1`, or the dependency-only skip options.
Use `i --bootstrap` when you want to inspect/fix generated shared and local resolver config and run
the repo bootstrap flow explicitly. In interactive shells, `i --bootstrap` first prints the local
reset plan so the existing refs and files that would be deleted are visible, then asks whether to
reset local bootstrap state before continuing. The default is to keep local state and run bootstrap.
Use `--yes` for non-interactive runs; `i --bootstrap --yes` also keeps local state and runs
bootstrap.
When bootstrap needs to choose the repo's default `main` secret backend, interactive shells show all
supported choices in a visible selector. Choose Infisical when repo secrets should live in an
Infisical project managed or adopted by repo bootstrap. Choose Vault when repo secrets should live
behind the Vault resolver profile. Choose macOS Keychain when local repo secrets should stay in the
login Keychain under the repo-derived `<workspace-name>` service. Automation can make the same
choice without a prompt:

```bash
i --bootstrap --secret-backend vault/default --yes
i --bootstrap --secret-backend infisical/default --yes
i --bootstrap --secret-backend keychain/default --yes
```

Vault selection materializes `vault-default` and points the `main` category at that profile. It does
not initialize, unseal, or administer Vault. For local validation and secret reads, provide the
Vault client settings documented in the Vault runbook, including `VBR_VAULT_ADDR` and the selected
credential source such as `VBR_VAULT_TOKEN`.
Keychain selection materializes `macos-keychain-default` and points the `main` category at that
profile. It requires macOS Keychain access from the process that reads or writes `secret://...`
values.

Deep bootstrap commands remain available for advanced recovery and debugging:

```bash
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --secret-backend vault/default
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --secret-backend infisical/default
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --secret-backend keychain/default
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --bootstrap-scope unfairly-common
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --infisical-project-name unfairly-common
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --bootstrap-keychain-service-name unfairly-bootstrap
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --keychain-service-name unfairly
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --apply-metadata-patch
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo --without-deployments
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --dry-run
viberoots/build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --yes
```

Fresh ExampleApp Infisical bootstrap is a reviewed metadata handoff into
`projects/config/shared.json` deployment contexts. If OpenTofu creates or adopts live resources
while context fields still have first-bootstrap placeholders, repo bootstrap prints a non-secret
patch and pauses before applying it. Interactive operators can approve the `[Y/n]` metadata gate;
non-interactive runs must add `--apply-metadata-patch`. Real drift against already-reviewed
non-placeholder values still fails closed.

This document intentionally redirects to the repo-root bootstrap spec at
[`infisical-bootstrap.md`](history/designs/infisical-bootstrap-spec.md). Keep command examples there and here on the
same `repo` or `deployment --target <buck-target>` mode vocabulary.

ExampleApp deployment targets in this guide are reusable examples that use canonical family labels
such as `//projects/deployments/example-app/staging:deploy`. A consuming workspace owns any real
family-specific migration history and should introduce new live families only through an explicit
product-approved plan PR.

Repo bootstrap materializes backend profile credentials under the reserved `bootstrap` namespace. By
default the next `secret://` path segment is the consumer workspace directory name, so a checkout
named `unfairly-common` uses refs such as
`secret://bootstrap/unfairly-common/viberoots-iac-bootstrap/client-id`. Set
`sprinkleref.bootstrapScope` in `projects/config/shared.json` to use a different stable scope, or
pass `--bootstrap-scope <name>` for a one-off bootstrap run. ExampleApp deployment bootstrap
continues to report only stage-specific managed workload refs under
`secret://deployments/example-app/<stage>/...`. If `projects/config/local.json` overrides profile auth
to another namespace, remove that local override and rerun
`viberoots/build-tools/tools/deployments/infisical-bootstrap.ts repo`.
Universal Auth client-secret records are per operator machine. Existing local credentials are reused
by default; a fresh machine creates its own labeled client-secret record and stores it only in the
selected local sink. Use `--machine-label <label>` when the hostname is not a useful revocation
label in Infisical.
For Infisical-backed repo secrets, repo bootstrap creates or adopts a repo-level Infisical
secret-manager project. By default that project name is the consumer workspace directory name, so a
checkout named `unfairly-common` uses an Infisical project named `unfairly-common`. Set
`sprinkleref.repoInfisicalProjectName` in `projects/config/shared.json` to use a different stable
project name, or pass `--infisical-project-name <name>` for a one-off bootstrap run.
For macOS Keychain-backed local storage, bootstrap uses repo-derived services by default:
`<workspace-name>-bootstrap` for repo bootstrap credentials and `<workspace-name>` for the
`keychain/default` main backend. Set `sprinkleref.bootstrapKeychainServiceName` or
`sprinkleref.repoKeychainServiceName` in `projects/config/shared.json` for stable shared overrides,
or pass `--bootstrap-keychain-service-name <name>` or `--keychain-service-name <name>` for one run.
Existing operator-authored Infisical profiles are preserved once their `projectId` validates in the
selected organization.
If Infisical rejects the default repo project creation because the organization has reached a
project or workspace plan limit, reuse an existing Infisical secret-manager project. Set
`sprinkleref.repoInfisicalProjectName` to the existing project name, pass
`--infisical-project-name <name>`, set `sprinkleref.profiles.<profile>.projectId` in
`projects/config/shared.json` for the generated Infisical profile, or export
`VBR_INFISICAL_PROJECT_ID` before rerunning bootstrap. The bootstrap error lists visible candidate
projects when Infisical returns them.
Before reporting success, repo bootstrap reads the generated bootstrap credential refs back from the
selected local sink, checks they match the machine's repo Universal Auth credential, and performs an
Infisical Universal Auth login probe. It also validates the default `main` resolver category: for
Infisical-backed profiles, the configured project must be reachable in the selected organization and
the profile's client id/client secret must authenticate. Non-Infisical `main` backends are reported
as not auth-probed because they do not have an Infisical login check.
Bootstrap rewrites only missing profiles, profiles with `generatedBy: "viberoots-repo-bootstrap"`,
or untouched legacy starter profiles that exactly match the old `VBR_INFISICAL_*` starter shape.
That legacy shape is exactly `backend: "infisical"`, `host: "https://app.infisical.com"`,
`projectIdEnv: "VBR_INFISICAL_PROJECT_ID"`, `defaultEnvironment: "staging"`, `defaultPath: "/"`,
`clientIdEnv: "VBR_INFISICAL_CLIENT_ID"`, and
`clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET"` with no other keys. Additional fields such as
`namespace`, custom refs, or future resolver metadata make the profile operator-authored.
To intentionally regenerate a profile, remove that profile or add the generated marker before
rerunning repo bootstrap.
Profiles that use operator-authored `projectIdEnv` are also preserved; confirmed bootstrap validates
the resolved env value when present and fails closed without rewriting the profile when the env var
is unset. Repo dry-run mirrors that closed state by reporting the profile in
`unresolvedExistingProfiles` instead of `validatedExistingProfiles`.
Repo dry-run reports the same backend profile set confirmed repo bootstrap will validate or
materialize: graph-required profiles plus active profiles selected by resolver categories, even when
the current deployment graph does not require that category-selected backend.
Repo bootstrap applies selected deployment-context defaults before computing required resolver
profiles. Deployment graph nodes with secret requirements and omitted `secret_backend` use the
selected context `secretBackend` when present, so ExampleApp context deployments require the
context-derived Infisical profile. Without a selected context backend, omitted `secret_backend`
continues to contribute the implicit `vault/default` profile.

Token-based `--no-login` bootstrap flows must pass exactly one of `--org-name` or
`--organization-id`; login-based operator flows may still use interactive or `--yes` single-org
discovery.

Expected local bootstrap artifacts are ignored and should not be committed:
`projects/config/local.json`, `.local/`, the OpenTofu `.terraform/` directory,
`terraform.tfstate*`, and `.terraform.lock.hcl`.
To intentionally return to a clean local bootstrap state without deleting Infisical cloud
resources and then bootstrap again, run:

```bash
i --bootstrap
```

Review the printed local reset plan. It starts with an explicit `DRY RUN` or `RESET` mode line and
lists only existing local files, directories, and Keychain refs that would be deleted. Each item
includes a short description of what that state is for. Resetting local state deletes local
credential copies; Infisical client secrets cannot be recovered from Infisical after creation, so
make sure any listed values you still need are backed up elsewhere before answering yes. The
lower-level reset utility remains available for recovery when you only want to remove local state
without immediately rerunning repo bootstrap:

```bash
build-tools/tools/deployments/infisical-bootstrap-reset-local.ts --dry-run
build-tools/tools/deployments/infisical-bootstrap-reset-local.ts
```

The reset utility prints the discovered reset plan, requires typing `RESET` or passing `--yes` when
there is state to remove, removes only generated local resolver/OpenTofu state, and deletes existing
repo bootstrap Universal Auth entries from the repo-derived `<workspace-name>-bootstrap` macOS
Keychain service. It does not delete Infisical projects, identities, Cloudflare secrets, or
application secrets.

Troubleshooting:

- Fresh machines should run `i` and accept the lazy setup prompt. The command creates this
  machine's repo and ExampleApp deployment Universal Auth credentials without importing another
  machine's secret. The prompt is line-based: type `y` or press Enter to accept, then press Enter.
- Stale macOS Keychain bootstrap credentials usually appear as Universal Auth login failures after
  repo metadata still validates. Rerun
  `i --rotate-bootstrap-credentials --force-overwrite-local-credentials` so the lazy setup path
  creates a new local value with the matching remote record. If Keychain access is unavailable, use
  the advanced bootstrap command with `--credential-sink local-file`.
- CI and other non-interactive dependency setup should use `i --without-secrets` or
  `INSTALL_DEPS_WITHOUT_SECRETS=1` unless the job intentionally performs local setup with `i --yes`
  or `INSTALL_DEPS_SETUP_SECRETS=1`.
- Deleted remote Universal Auth client-secret records are not recoverable from Infisical; the
  client secret is only available when created. A machine with stale local credentials should rerun
  `i --rotate-bootstrap-credentials --force-overwrite-local-credentials` for repo bootstrap
  credentials or `i --rotate-deployment-credentials --force-overwrite-local-credentials` for
  deployment credentials instead of editing reviewed deployment metadata.
- First-bootstrap metadata handoff is expected only when reviewed values are placeholders or empty
  first-bootstrap fields. Drift against already-reviewed project ids, identity ids, environment
  slugs, secret names, or refs requires a human Infisical review before retrying.
- Incomplete OpenTofu output is not a handoff. Missing live project ids, stage identity ids, or
  generated credential file names must be fixed by rerunning or repairing the deployment bootstrap
  output path before applying any reviewed metadata patch.
- Divergent fan-out handoff patches are a hard stop. If repo bootstrap reports that deployment
  targets disagree on the metadata patch, inspect the named OpenTofu outputs and do not apply a
  repo-level metadata patch until every target produces the same reviewed patch.
- The generated first-bootstrap patch is applied by reviewed constant and stage key. Duplicate
  placeholder or live-looking values in comments, Vault metadata, stable refs, or unrelated
  constants are intentionally ignored.
