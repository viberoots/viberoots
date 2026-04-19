# Vault Production Bootstrap Runbook

This runbook shows how to bootstrap Vault as the production source of truth for
deployment secrets.

This runbook assumes Vault is added declaratively to a flakes-based NixOS host.
Vault, the Vault CLI, storage directories, firewall access, and the
ACME-managed TLS certificate for `*.apps.kilty.io` are declared through the
host's NixOS configuration before any `vault operator ...` commands are run.

Important current-repo reality:

- the reviewed production runtime now reads Vault directly through
  `VAULT_ADDR` plus `VAULT_TOKEN`
- the exported JSON secret fixture path through
  `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`
  remains available only for reviewed local, test, and bootstrap-oriented
  workflows, not as the normal production runtime mechanism
- this runbook therefore covers both:
  - bootstrapping Vault itself for the direct runtime path
  - optionally exporting the reviewed secret fixture for local/test workflows

Use this runbook when:

- you are setting up production or shared-environment secret storage for the
  first time
- you are adding a new deployment secret contract and want Vault to be the
  source of truth
- you are rotating or replacing a secret and need to regenerate the optional
  local/test runtime export used by a bootstrap or isolated test workflow

## What Success Looks Like

At the end of this runbook:

- the NixOS host flake declares Vault as a managed service rather than relying
  on manually installed packages or ad hoc systemd units
- Vault is initialized, unsealed, reachable over TLS, and auditing requests
- a KV v2 secrets engine exists at `secret/`
- an AppRole-based machine identity can read only the reviewed deployment
  secret paths it needs
- deployment secrets are stored in Vault using a predictable path convention
- the reviewed production runtime can read those secrets directly with
  `VAULT_ADDR` plus `VAULT_TOKEN`
- when needed, a reviewed `deployment-secret-fixture@1` file can still be
  exported from Vault for local/test flows through
  `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`

## Before You Start

You need:

- a flakes-based NixOS host that will run Vault
- SSH or console access to that host with permission to edit and rebuild its
  NixOS configuration
- DNS control for `apps.kilty.io` with DNS-01 ACME support for the
  `*.apps.kilty.io` wildcard certificate
- DNS records that route `secrets.apps.kilty.io` and, for a cluster,
  node-specific names such as `vault-1.apps.kilty.io` to the Vault host or hosts
- the `vault` CLI and `jq`; the NixOS example below installs Vault and assumes
  `jq` is already present in the shared host package list
- network access to the Vault server or cluster
- an operator credential that can initialize Vault or change mounts, auth
  methods, policies, and secrets
- the exact `contract_id` values declared in deployment metadata
- the exact target scope values used by the deployment runtime

Example values used in this runbook:

- Vault address:
  `https://secrets.apps.kilty.io:8200`
- Vault wildcard certificate:
  `*.apps.kilty.io`
- Vault host:
  the existing `mini` NixOS flake target
- Vault listener:
  direct TLS on TCP `8200`, not an nginx HTTP reverse proxy
- contract ID:
  `secret://deployments/pleomino/cloudflare_api_token`
- deployment target scope:
  `cloudflare-pages:web-platform-staging/pleomino-staging-pages`
- optional exported secret fixture path:
  `.local/deploy-secrets/secret-fixture.json`

## How To Choose `targetScopes`

Use the deployment's exact admitted target value for `targetScopes`.

Use this rule:

- `targetScopes` should contain the exact deployment `lockScope` value that the
  runtime will check at secret-use time

In the current code:

- the secret runtime compares `targetScopes` against the runtime `targetScope`
- the convenience helper sets that runtime `targetScope` from
  `admittedContext.targetEnvironment.lockScope`
- for normal deploy flows, that `lockScope` is usually the same as the
  deployment target's canonical `providerTargetIdentity`

Practical operator workflow:

1. if this is first-time setup and no run exists yet, ask the repo for the
   canonical target identity:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-target-identity
```

For ordinary deploy flows, use that exact output string in `targetScopes`.

2. if the deployment already has a submitted run, verify the exact admitted
   value from status:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-run-lock-scope \
  --deploy-run-id "$DEPLOY_RUN_ID" \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Use that exact `lockScope` value in `targetScopes`.

3. precedence rule:

- for normal first-time setup, `--print-target-identity` is the
  practical default
- once a run exists, `lockScope` from the status API is the more exact value
- for preview or any other non-default flow, prefer the exact status value over
  assumptions

Common shapes:

- Cloudflare Pages:
  `cloudflare-pages:<account>/<project>`
  Example:
  `cloudflare-pages:web-platform-staging/pleomino-staging-pages`
- `nixos-shared-host`:
  `nixos-shared-host:<target-group>:<app>`
  Example:
  `nixos-shared-host:shared-dev:pleomino`
- S3 static:
  `s3-static:<account>/<bucket>`
- Kubernetes:
  `kubernetes:<cluster>/<namespace>/<release>`
- App Store Connect:
  `app-store-connect:<issuer>/<app>#track:<track>`
- Google Play:
  `google-play:<developer-account>/<app>#track:<track>`

## Plain-Language Model

The deployment system uses four layers:

1. the repo stores a stable contract ID such as
   `secret://deployments/pleomino/cloudflare_api_token`
2. admission freezes admitted secret references that capture the non-secret
   replay/runtime details for one run
3. Vault stores the real secret value and the metadata that says where it may
   be used
4. the reviewed production runtime reads Vault directly, while local/test
   workflows can intentionally use an exported secret fixture file with the same
   contracts and metadata

In other words: Vault is the long-lived source of truth, and the exported
secret fixture is an optional override for local/test/bootstrap flows rather
than the normal production runtime path.

## Recommended Path Convention

The repo does not currently enforce a Vault path convention, so this runbook
uses one recommended convention to keep operator workflows predictable.

Map each contract ID to a KV v2 path under `secret/`:

- contract ID:
  `secret://deployments/pleomino/cloudflare_api_token`
- Vault KV path:
  `secret/deployments/pleomino/cloudflare_api_token`

Use the same pattern for other secrets:

- `secret://deployments/pleomino/preview_basic_auth_password`
  becomes `secret/deployments/pleomino/preview_basic_auth_password`
- `secret://deployments/demoapp/database_url`
  becomes `secret/deployments/demoapp/database_url`

This convention keeps the Vault paths and exported secret fixture aligned with
the contract IDs used in deployment metadata.

## Step 0: Add Vault To The Existing NixOS Host

Start by making Vault part of the existing host configuration. Do not install
Vault by hand with an imperative package manager or a one-off systemd unit; the
service, CLI tools, storage path, listener, certificate access, and firewall
opening should all be reviewed flake state.

The intended production design is:

- the existing Route53-backed ACME configuration issues the wildcard certificate
  for `*.apps.kilty.io`
- Vault uses that certificate directly and terminates TLS itself
- nginx is not in the Vault request path for `secrets.apps.kilty.io`
- the existing nginx `apps.kilty.io` virtual host can continue to use
  `publicTcpPort`, but Vault should not be added as a normal nginx HTTP reverse
  proxy behind that virtual host
- HTTP port 80 does not need to be open for ACME because wildcard certificates
  require a DNS challenge

In the existing top-level NixOS module, add Vault-specific names alongside the
other `let` bindings:

```nix
vaultDomain = "secrets.apps.kilty.io";
vaultNodeDomain = "vault-1.apps.kilty.io";
appsAcmeCertName = "apps.kilty.io";
appsAcmeCertDir = config.security.acme.certs.${appsAcmeCertName}.directory;
```

Then add Vault to the reviewed host configuration. In the existing
`environment.systemPackages` list, add the Vault CLI package:

```nix
environment.systemPackages = with pkgs; [
  # Existing packages stay here.
  config.services.vault.package
];
```

Add the Vault service and keep the package allowlist narrow:

```nix
{
  # HashiCorp Vault is unfree in current nixpkgs. Keep this narrow instead of
  # enabling all unfree packages for the host.
  nixpkgs.config.allowUnfreePredicate = pkg:
    builtins.elem (lib.getName pkg) [ "vault" ];

  services.vault = {
    enable = true;
    storageBackend = "raft";
    storagePath = "/var/lib/vault";
    address = "0.0.0.0:8200";
    tlsCertFile = "${appsAcmeCertDir}/fullchain.pem";
    tlsKeyFile = "${appsAcmeCertDir}/key.pem";
    listenerExtraConfig = ''
      tls_min_version = "tls12"
    '';
    extraConfig = ''
      ui = true
      disable_mlock = false
      api_addr = "https://${vaultDomain}:8200"
      cluster_addr = "https://${vaultNodeDomain}:8201"
    '';
  };

  systemd.services.vault = {
    after = [ "acme-${appsAcmeCertName}.service" ];
    wants = [ "acme-${appsAcmeCertName}.service" ];
  };
}
```

In the real host file, extend the existing firewall expression rather than
defining `networking.firewall.allowedTCPPorts` a second time. With the current
shape, that means adding `8200` to the existing literal list:

```nix
networking.firewall.allowedTCPPorts =
  [ 445 139 53 443 3389 publicTcpPort 8200 ]
  ++ lib.attrsets.mapAttrsToList (name: value: value) openTcpPorts;
```

Update the existing `apps.kilty.io` ACME certificate so both nginx and Vault can
read the certificate material. Prefer a dedicated shared certificate-reader group
instead of putting Vault into the nginx group:

```nix
users.groups.apps-acme.members = [
  config.services.nginx.user
  "vault"
];

security.acme.certs."apps.kilty.io" = {
  domain = "*.apps.kilty.io";
  extraDomainNames = [
    # Keep the apex name because *.apps.kilty.io does not cover apps.kilty.io.
    # Do not add secrets.apps.kilty.io here; it is already covered by the
    # wildcard and Let's Encrypt rejects redundant names in the same order.
    "apps.kilty.io"
  ];
  dnsProvider = "route53";
  credentialsFile = "/root/aws-credentials";
  group = "apps-acme";
  postRun = ''
    systemctl try-restart vault.service
  '';
};
```

Keep the existing Route53 credential file managed outside the public repo and do
not make it world-readable. If the host later moves to a secret-management module
such as sops-nix or age, point `credentialsFile` at the managed secret path
instead of embedding credentials in the Nix file.

If ACME fails with a message that `secrets.apps.kilty.io` is redundant with the
wildcard domain, remove that exact hostname from `extraDomainNames`. The
wildcard certificate for `*.apps.kilty.io` already covers it.

Do not add `secrets.apps.kilty.io` to `services.nginx.virtualHosts` using the
normal `reverseProxy` helper. That would terminate TLS at nginx and forward a
second HTTP hop to Vault. The recommended path is to route TCP `8200` directly to
Vault so Vault is the TLS endpoint. If the network must expose only one external
TLS port, design that separately as TCP/SNI passthrough rather than as an HTTP
reverse proxy.

Apply the host configuration:

```bash
sudo nixos-rebuild switch --flake /etc/nixos#mini
```

After the first switch, confirm that ACME has issued the wildcard certificate and
that Vault can read it:

```bash
systemctl status acme-apps.kilty.io.service
sudo ls -l /var/lib/acme/apps.kilty.io/
```

Confirm the managed service exists and is listening:

```bash
systemctl status vault.service
sudo ss -ltnp | grep ':8200'
```

If `nixos-rebuild switch` reports only that `vault.service` failed and the
status output says the start request repeated too quickly, inspect the earlier
Vault log lines before changing the NixOS config again:

```bash
sudo journalctl -u vault.service -b -n 120 --no-pager
```

Repeat that journal check after each fix. `systemctl status` often reports only
the restart limit, while the actionable Vault error appears earlier in the unit
journal.

Vault 1.20 and newer require `disable_mlock` to be set explicitly. The
recommended production setting is `disable_mlock = false`, which keeps Vault from
swapping plaintext secrets to disk. If the journal says `disable_mlock must be
configured 'true' or 'false'`, add that setting to `services.vault.extraConfig`
and rebuild:

```nix
services.vault.extraConfig = ''
  ui = true
  disable_mlock = false
  api_addr = "https://${vaultDomain}:8200"
  cluster_addr = "https://${vaultNodeDomain}:8201"
'';
```

The most likely first-start issue is certificate access. Confirm that the
existing wildcard certificate is owned by the shared certificate-reader group and
that the `vault` user is a member of that group:

```bash
getent group apps-acme
id vault
sudo namei -l /var/lib/acme/apps.kilty.io/key.pem
sudo ls -l /var/lib/acme/apps.kilty.io/
```

If the journal says Vault cannot read `fullchain.pem` or `key.pem`, verify that
`security.acme.certs."apps.kilty.io".group = "apps-acme";` is applied and
restart the ACME setup unit so it can refresh the existing certificate directory
permissions after the group change:

```bash
sudo systemctl restart acme-setup.service
sudo namei -l /var/lib/acme/apps.kilty.io/key.pem
sudo systemctl reset-failed vault.service
sudo systemctl restart vault.service
```

If the files are still owned by the old nginx-only group after restarting
`acme-setup.service`, confirm the active flake evaluation really sets the cert
group to `apps-acme` before manually changing ownership.

Only continue once the service starts cleanly. If this is a multi-node
production Vault cluster, add the other raft nodes declaratively first and
follow your reviewed cluster-join procedure before moving secrets into Vault.

Confirm the Vault API name resolves before using the CLI. The TLS certificate is
valid for `secrets.apps.kilty.io`, so prefer fixing DNS over using
`https://127.0.0.1:8200` with certificate verification disabled:

```bash
getent hosts secrets.apps.kilty.io
dig +short secrets.apps.kilty.io
```

For the production path, create an authoritative `secrets.apps.kilty.io` DNS
record that points at the address clients should use to reach Vault. For a local
first bootstrap on the Vault host, a temporary host-local mapping is acceptable
as long as the public or internal DNS record is added before other clients depend
on Vault:

```nix
networking.hosts."127.0.0.1" = [ vaultDomain ];
```

## Step 1: Point The CLI At Vault

Set the Vault address on the machine that will perform the bootstrap:

```bash
export VAULT_ADDR='https://secrets.apps.kilty.io:8200'
```

Before initializing Vault, confirm the CLI can reach the server over the intended
TLS name:

```bash
vault status
```

For a brand-new server, the expected result is `Initialized false`, `Sealed
true`, and `Storage Type raft`. That means the NixOS service, DNS name, TLS
certificate, and storage backend are wired correctly and the next step is
initialization.

If your environment requires a custom CA bundle, set that before continuing.

## Step 2: Initialize And Unseal Vault

If Vault is already initialized and unsealed, skip to the next step.

Initialize the storage backend once:

```bash
vault operator init -key-shares=5 -key-threshold=3 > vault-init.txt
```

`vault-init.txt` is the only time Vault prints the initial unseal key shares and
the initial root token. Its shape is similar to this, with real secret values in
place of the placeholders:

```text
Unseal Key 1: <generated-unseal-key-share-1>
Unseal Key 2: <generated-unseal-key-share-2>
Unseal Key 3: <generated-unseal-key-share-3>
Unseal Key 4: <generated-unseal-key-share-4>
Unseal Key 5: <generated-unseal-key-share-5>

Initial Root Token: <generated-initial-root-token>
```

Common example values and when to use them:

- `-key-shares=5`
  Create five unseal key shares so the recovery responsibility can be split
  across multiple operators.
- `-key-threshold=3`
  Require any three of those shares to unseal Vault.

What the generated values mean:

- `Unseal Key 1` through `Unseal Key 5` are key shares generated by Vault during
  initialization. They are not chosen by the operator and they should not be
  edited, shortened, renamed, or re-generated casually.
- Any three different unseal key shares can unlock the server after a restart or
  seal event. The example commands below use keys 1, 2, and 3 only because they
  are easy placeholders; keys 2, 4, and 5 would work just as well.
- One unseal key share by itself is intentionally insufficient. Split the shares
  across trusted operators or escrow locations so no single person or storage
  location can unseal Vault alone.
- The `Initial Root Token` is different from the unseal keys. It authenticates to
  Vault after unseal and can administer Vault. Use it only for bootstrap tasks,
  create narrower operator or machine credentials, then revoke or escrow it
  according to the production access policy.
- If an unseal key share is lost or an operator leaves, follow a reviewed Vault
  rekey procedure after Vault is unsealed; do not re-run `vault operator init` on
  an initialized production Vault.

Important handling rules:

- do not leave `vault-init.txt` on the Vault server
- move the unseal keys and initial root token into your real secure escrow
  process immediately
- treat the initial root token as bootstrap-only, not as an everyday operator
  credential

Then unseal Vault with enough key shares to meet the threshold:

```bash
vault operator unseal '<generated-unseal-key-share-1>'
vault operator unseal '<generated-unseal-key-share-2>'
vault operator unseal '<generated-unseal-key-share-3>'
```

Each command submits one complete `Unseal Key N` value from `vault-init.txt`.
After the third valid share, `vault status` should report `Sealed false`.

If you are running more than one Vault node, unseal each node the same way.

Before continuing with administrative setup, authenticate with the `Initial Root
Token` from `vault-init.txt` in the current shell:

```bash
export VAULT_TOKEN='<generated-initial-root-token>'
vault token lookup
```

The root token is needed for the bootstrap-only administration in the next
several steps, such as enabling audit devices, enabling auth methods, writing
policies, and storing the first secrets. Do not use it as the normal deployment
runtime token.

## Step 3: Enable Audit Logging

Enable at least one audit device before storing production secrets:

```bash
vault audit enable syslog tag="vault-audit" facility="AUTH"
```

If this returns `permission denied`, check that `VAULT_TOKEN` is set to the
initial root token or to another token with permission to manage `sys/audit`.
Read-only deployment tokens and AppRole runtime tokens cannot enable audit
devices.

Example values:

- `syslog`
  Sends Vault audit events to the host syslog path. On this NixOS host, that lets
  operators inspect audit events with the same `journalctl` workflow used for
  other services.
- `tag="vault-audit"`
  Sets the syslog identifier so Vault audit events are easier to filter.
- `facility="AUTH"`
  Routes the audit events through the authentication/security syslog facility.

Verify the audit device is enabled and visible through the journal:

```bash
vault audit list
journalctl -t vault-audit --since "5 minutes ago" --no-pager
```

Treat the journal as part of the audit trail. Vault audit entries HMAC sensitive
fields by default, but the logs still contain security-sensitive operational
metadata, so journal access, retention, and forwarding should match the
production audit policy.

If your environment specifically requires a dedicated file audit device, enable
the file backend instead or in addition to syslog:

```bash
vault audit enable file file_path=/var/log/vault_audit.log mode=0600
```

For a file backend:

- `file_path=/var/log/vault_audit.log`
  Uses a simple host-local audit log path.
- `mode=0600`
  Restricts the audit log to the owning user.

Use a different audit device if your environment requires centralized logging,
but keep Vault auditing enabled before continuing.

## Step 4: Enable The KV v2 Secrets Engine

This runbook uses a KV v2 engine mounted at `secret/`:

```bash
vault secrets enable -path=secret kv-v2
```

Use `secret/` when you want the examples in this runbook to work exactly as
written.

If your environment already uses a different mount path, keep that path
consistent across policies, write commands, runtime configuration, and any
optional fixture-export scripts.

## Step 5: Enable AppRole For Machine Access

Enable the AppRole auth method:

```bash
vault auth enable approle
```

Use AppRole when a CI job or deployment helper needs machine-to-machine access
to Vault without an interactive human login.

## Step 6: Create A Least-Privilege Read Policy

Write a policy that allows the deployment runtime to read only the specific
deployment secrets it needs.

Create `deploy-pleomino-read.hcl`:

```hcl
path "secret/data/deployments/pleomino/*" {
  capabilities = ["read"]
}
```

Then upload it:

```bash
vault policy write deploy-pleomino-read deploy-pleomino-read.hcl
```

Use narrower paths when possible:

- `path "secret/data/deployments/pleomino/*"`
  Use this when one app family should read only its own deployment secrets.
- `path "secret/data/deployments/*"`
  Broader and usually less desirable. Use only when one trusted machine really
  must read many deployment families.

## Step 7: Create The Deployment Reader AppRole

Create an AppRole that uses that read policy:

```bash
vault write auth/approle/role/deploy-pleomino-read \
  token_policies="deploy-pleomino-read" \
  secret_id_ttl="30m" \
  token_ttl="30m" \
  token_max_ttl="2h"
```

Example values and when to use them:

- `token_policies="deploy-pleomino-read"`
  Attach only the read policy created above.
- `secret_id_ttl="30m"`
  Use a short lifetime for the bootstrap credential handed to CI, the deployment
  helper, or an explicit fixture export job.
- `token_ttl="30m"`
  Use a short-lived token for routine deployment runs.
- `token_max_ttl="2h"`
  Give enough time for one controlled deployment job without creating a long-lived
  credential.

Read back the role ID and create one secret ID:

```bash
vault read -field=role_id auth/approle/role/deploy-pleomino-read/role-id
```

```bash
vault write -format=json -f auth/approle/role/deploy-pleomino-read/secret-id \
  | jq -r '.data.secret_id'
```

Keep both values secure. Together they are the machine credential that can mint a
Vault token for the deployment runtime. The same credential can also be used for
the optional fixture export path when a reviewed local/test workflow needs one.

## Step 8: Store Secrets In Vault

Store each deployment secret under the recommended KV path using JSON files.

Create `cloudflare_api_token.json`:

```json
{
  "value": "super-secret-token",
  "allowedSteps": ["publish"],
  "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
  "refreshMode": "renew",
  "credentialClass": "routine"
}
```

Write it to Vault:

```bash
vault kv put -mount=secret \
  deployments/pleomino/cloudflare_api_token \
  @cloudflare_api_token.json
```

Create a second example secret if the deployment also needs an authenticated
smoke-check credential:

```json
{
  "value": "preview-password",
  "allowedSteps": ["smoke"],
  "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
  "refreshMode": "none",
  "credentialClass": "routine"
}
```

```bash
vault kv put -mount=secret \
  deployments/pleomino/preview_basic_auth_password \
  @preview_basic_auth_password.json
```

What these fields mean:

- `"value": "super-secret-token"`
  The actual secret value returned to the runtime.
- `"allowedSteps": ["publish"]`
  Use `publish` for provider credentials needed only while publishing.
- `"allowedSteps": ["smoke"]`
  Use `smoke` for credentials needed only during smoke checks.
- `"targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"]`
  Restrict the secret to the exact deployment target that should use it. This
  should match the deployment's admitted `lockScope`.
- `"refreshMode": "renew"`
  Use when the same credential should be renewed in place.
- `"refreshMode": "none"`
  Use when no refresh behavior is needed.
- `"credentialClass": "routine"`
  Normal day-to-day deployment credential.

## Step 9: Provide A Deployment Runtime Vault Token

The current reviewed deployment runtime reads Vault with `VAULT_ADDR` plus
`VAULT_TOKEN`. It does not log in to AppRole by itself yet, so something in the
deployment environment must mint a short-lived Vault token before `deploy` runs.

That token-minting step can be handled by CI, a small wrapper script, a host
credential service, or a future deployment-tool enhancement. The important
runtime contract today is that `deploy` receives a short-lived `VAULT_TOKEN`,
not the long-lived AppRole `role_id` and `secret_id` directly.

For a manual bootstrap or a simple wrapper, use the AppRole credentials to mint
the token:

```bash
export ROLE_ID='replace-with-role-id'
export SECRET_ID='replace-with-secret-id'

export VAULT_TOKEN="$(
  vault write -format=json auth/approle/login \
    role_id="$ROLE_ID" \
    secret_id="$SECRET_ID" \
    | jq -r '.auth.client_token'
)"
```

Use this token only for the deployment run or the optional fixture export step
below. Do not reuse it as a general operator token, and do not store it in the
repo.

## Step 10: Optional: Export The Secret Fixture From Vault

Skip this step for the normal production path. Production deployments should use
the Vault API directly through `VAULT_ADDR` plus `VAULT_TOKEN`.

Use this step only for reviewed local development, isolated tests, or explicit
bootstrap-oriented workflows that cannot call Vault directly. The reviewed
fixture override path expects a `deployment-secret-fixture@1` file keyed by
contract ID.

Create the export directory and write the file:

```bash
mkdir -p .local/deploy-secrets

jq -n \
  --argjson cloudflare_api_token "$(
    vault kv get -format=json -mount=secret deployments/pleomino/cloudflare_api_token \
      | jq '.data.data'
  )" \
  --argjson preview_basic_auth_password "$(
    vault kv get -format=json -mount=secret deployments/pleomino/preview_basic_auth_password \
      | jq '.data.data'
  )" \
  '{
    schemaVersion: "deployment-secret-fixture@1",
    contracts: {
      "secret://deployments/pleomino/cloudflare_api_token": $cloudflare_api_token,
      "secret://deployments/pleomino/preview_basic_auth_password": $preview_basic_auth_password
    }
  }' > .local/deploy-secrets/secret-fixture.json
```

Lock down the exported file:

```bash
chmod 0600 .local/deploy-secrets/secret-fixture.json
```

Important handling rules:

- do not commit this file
- keep it outside world-readable directories
- regenerate it after each secret rotation
- delete old exports once the new export is in use

## Step 11: Optional: Point The Runtime At The Fixture Export

Set the optional fixture override env var only for local development, isolated
tests, or explicit bootstrap-oriented workflows:

```bash
export BNX_DEPLOYMENT_SECRET_FIXTURE_PATH="$PWD/.local/deploy-secrets/secret-fixture.json"
```

Do not set `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH` for normal production
deployments. When the variable is unset, the reviewed production runtime resolves
the same contract IDs directly through the Vault API.

## Step 12: Run A Deployment Through Vault

For the normal production path, keep `VAULT_ADDR` and a short-lived
`VAULT_TOKEN` in the deployment environment and leave
`BNX_DEPLOYMENT_SECRET_FIXTURE_PATH` unset:

```bash
export VAULT_ADDR='https://secrets.apps.kilty.io:8200'
unset BNX_DEPLOYMENT_SECRET_FIXTURE_PATH
```

Then run the normal deployment flow:

```bash
deploy --deployment //projects/deployments/pleomino-staging:deploy
```

If you want to force one exact local build output, you can still provide the
usual override:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --artifact-dir ./dist
```

## Step 13: Verify The Result

A healthy end-to-end result looks like this:

- the deploy succeeds or reaches the expected approval gate
- the runtime can resolve the required contract IDs for the active lifecycle
  step
- the durable deployment record stores
  `secret://deployments/pleomino/cloudflare_api_token`
  rather than the raw token value
- `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH` is unset for normal production runs
- any exported fixture file exists only where a reviewed local/test or bootstrap
  workflow needs it

## Rotation And Ongoing Operations

When you rotate a secret:

1. write a new version at the same Vault path
2. verify a deployment run can read the new version through the Vault API
3. if a reviewed local/test workflow uses a fixture export, regenerate that
   fixture and replace the file referenced by `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`
4. remove stale local/test fixture files

Example rotation write:

```bash
vault kv put -mount=secret \
  deployments/pleomino/cloudflare_api_token \
  @cloudflare_api_token.json
```

Keep the `contract_id` stable during rotation. The secret value changes, but the
repo-level contract name should not.

## Related Docs

- [Secrets Usage](/Users/kiltyj/Code/bucknix-fresh/docs/secrets-usage.md)
- [Deployment And Secrets API](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-secrets-api.md)
- [Deployments Usage](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-usage.md)

## External References

These Vault commands are based on the official HashiCorp docs:

- [operator init](https://developer.hashicorp.com/vault/docs/commands/operator/init)
- [operator unseal](https://developer.hashicorp.com/vault/docs/commands/operator/unseal)
- [audit enable](https://developer.hashicorp.com/vault/docs/commands/audit/enable)
- [KV v2 setup](https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2/setup)
- [AppRole auth](https://developer.hashicorp.com/vault/docs/auth/approle)
- [policy write](https://developer.hashicorp.com/vault/docs/commands/policy/write)
- [kv put](https://developer.hashicorp.com/vault/docs/commands/kv/put)
