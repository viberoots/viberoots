# Vault Production Bootstrap Runbook

This runbook shows how to bootstrap Vault as the production source of truth for
deployment secrets.

This runbook assumes Vault is added declaratively to a flakes-based NixOS host.
Vault, the Vault CLI, storage directories, firewall access, and the
ACME-managed TLS certificate for `*.apps.kilty.io` are declared through the
host's NixOS configuration before any `vault operator ...` commands are run.

Important current-repo reality:

- the reviewed production runtime now reads remote Vault directly instead of
  treating an exported fixture as the normal production secret source
- normal deploys derive Vault address, issuer, audience, client id, role, and
  bound claims from deployment `vault_runtime` metadata, mint a fresh workload
  JWT, and pass a typed in-memory secret context to the secret backend
- workload JWTs and Vault tokens stay out of normal deploy environment
  variables; `VAULT_TOKEN` remains only for manual Vault bootstrap/admin CLI
  moments outside the deployment runtime
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
- a JWT auth role binds the reviewed deployment identity claims to the least
  privilege read policy
- deployment secrets are stored in Vault using a predictable path convention
- the reviewed production runtime can exchange a workload JWT for a short-lived
  Vault token and read those secrets without a pre-minted `VAULT_TOKEN`
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
- repo access to run `deploy --deployment <label> --print-vault-bootstrap`
  and `deploy --deployment <label> --print-vault-secret-templates`
- operator-owned IdP/Vault inputs that are not deployment metadata:
  issuer URL, Vault audience, deployment client id, Vault JWT role name, and
  any extra bound claims

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

## Start Here: Generate Deployment-Derived Material

Start every deployment-specific Vault bootstrap by asking the reviewed repo
metadata to print the deterministic parts. This prevents operators from copying
contract IDs, target scopes, Vault KV paths, policy names, role claims, or
repository claims by hand.

Generate the machine-readable bootstrap bundle:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-bootstrap \
  --vault-bootstrap-format=json \
  --issuer-url https://identity.apps.kilty.io/realms/deployments \
  --vault-audience deployments-vault \
  --deployment-client-id deployment-runner \
  --vault-jwt-role deploy-pleomino-read \
  > vault-bootstrap.json
```

Generate the fill-in secret templates:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-secret-templates \
  --vault-secret-template-format=files \
  > vault-secret-templates.txt
```

For copy/paste bootstrap command review, the same helper can render shell or
policy HCL:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-bootstrap \
  --vault-bootstrap-format=shell \
  --issuer-url https://identity.apps.kilty.io/realms/deployments \
  --vault-audience deployments-vault \
  --deployment-client-id deployment-runner \
  --vault-jwt-role deploy-pleomino-read
```

The helper is read-only. It does not initialize Vault, unseal Vault, write
policies, write JWT roles, configure Keycloak, accept real secret values, or
store anything in Vault.

Derived by the helper:

- deployment id, label, provider, stage, and canonical provider target identity
- target scope, normally the provider target identity; pass `--deploy-run-id`
  with the control-plane lookup flags when you need the exact admitted run
  `lockScope`
- repository claim from lane governance metadata
- secret contract IDs from `secret_requirements`
- reviewed KV v2 mount/path mapping for `secret://...` contracts
- allowed deployment steps for each secret requirement
- deterministic read policy HCL and a mechanical default policy name
- secret JSON templates with `value = "<fill-me>"`, `allowedSteps`,
  `targetScopes`, `refreshMode`, and `credentialClass`

Operator supplied:

- issuer URL, Vault audience, deployment client id, Vault JWT role name, policy
  name override, and optional `--vault-bound-claim key=value` entries
- real secret values for the generated JSON templates
- Vault address, bootstrap operator credential, unseal custody, Keycloak client
  secret, and workload JWT delivery

Stable JSON schemas:

- `deployment-vault-bootstrap@1` contains `deployment`, `targetScope`, `vault`,
  `policyHcl`, `secretTemplates`, `runtimeEnvironment`, and `warnings`
- `deployment-vault-secret-templates@1` contains `deployment`, `targetScope`,
  `empty`, `message`, and `templates`

If a deployment declares no secret requirements, the secret-template helper
prints an explicit empty/no-op document. Bootstrap output fails closed in that
case because there is no least-privilege secret policy to create.

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

1. if this is first-time setup and no run exists yet, use the generated
   `targetScope.value` from:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-secret-templates
```

For ordinary deploy flows, the helper uses the canonical provider target
identity in `targetScopes`.

2. if the deployment already has a submitted run, verify the exact admitted
   value by passing the run id into the helper:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-secret-templates \
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
- if you only need to inspect an existing run without rendering templates, the
  lower-level helper remains:
  `deploy --print-run-lock-scope --deploy-run-id "$DEPLOY_RUN_ID"`

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

In the existing top-level NixOS module, add the shared service names alongside
the other `let` bindings. In the host shape shown above, these belong in the
same `let` block as `vaultDomain`, `serviceTcpPorts`, `homeDomain`, and the
other local constants, before the final `in { ... }`:

```nix
vaultDomain = "secrets.apps.kilty.io";
identityDomain = "identity.apps.kilty.io";
keycloakHttpPort = 8091;
acmeCertName = "apps.kilty.io";
acmeCertDir = config.security.acme.certs.${acmeCertName}.directory;
```

Choose a Keycloak loopback port that is not already used by the host. In the
host shape shown above, `8081` is already used by `mitmWebPort`, so the example
uses `8091`.

For a single-node Vault host, use `vaultDomain` for both `apiAddress` and
`clusterAddress`. If you later run a multi-node Vault cluster, add a separate
node-specific binding such as `vaultNodeDomain = "vault-1.apps.kilty.io";` and
use that for `clusterAddress`.

Then import the reviewed Vault module from the repo checkout once. Because
`nixos-rebuild switch --flake /etc/nixos#mini` evaluates the host flake in pure
mode, do not import `/srv/common/...` as an absolute path from
`configuration.nix`. Also avoid making all of `/srv/common` a flake input,
because that snapshots the full repo into the store on rebuild. Add only the
small module directory as a non-flake path input instead:

```nix
# /etc/nixos/flake.nix
{
  inputs.deploymentModules = {
    url = "path:/srv/common/build-tools/tools/nix";
    flake = false;
  };

  outputs = { nixpkgs, deploymentModules, ... }@inputs: {
    nixosConfigurations.mini = nixpkgs.lib.nixosSystem {
      # Existing system and modules settings stay here.
      specialArgs = {
        # Existing specialArgs stay here.
        deploymentModulesRoot = deploymentModules;
      };
    };
  };
}
```

Then add `deploymentModulesRoot` to the existing argument set at the top of
`configuration.nix` and import the module through that flake input. This keeps
the import pure while copying only the small `build-tools/tools/nix` subtree
from the checkout that lives at `/srv/common`:

```nix
{ config, lib, pkgs, deploymentModulesRoot, nixpkgsUnstable, nixosHardware, nixMinecraft, ... }:

{
  imports = [
    # Existing imports stay here.
    "${deploymentModulesRoot}/shared-host-vault-module.nix"
  ];
}
```

The import makes the `deploymentHost.vault.*` options available in the same
NixOS module graph. Do not also declare a parallel `services.vault` block unless
you are intentionally overriding a specific option from the module.

In the existing `environment.systemPackages` list, keep or add the Vault CLI
package. Using `config.services.vault.package` keeps the CLI aligned with the
service package selected by the module:

```nix
environment.systemPackages = with pkgs; [
  # Existing packages stay here.
  config.services.vault.package
];
```

Configure the module for direct public TLS on the existing wildcard certificate:

```nix
deploymentHost.vault = {
  enable = true;
  address = "0.0.0.0:8200";
  storageBackend = "raft";
  storagePath = "/var/lib/vault";
  useAcmeCertificate = true;
  acmeCertName = acmeCertName;
  acmeGroup = "apps-acme";
  publicHostname = vaultDomain;
  addLocalHostname = true;
  apiAddress = "https://${vaultDomain}:8200";
  clusterAddress = "https://${vaultDomain}:8201";
  listenerExtraConfig = ''
    tls_min_version = "tls12"
  '';

  # The pasted host already extends allowedTCPPorts manually. Leave this false
  # there and add 8200 to that existing expression instead of creating a second
  # firewall owner.
  openFirewall = false;
};
```

That is the complete Vault service wiring for the recommended module path. The
remaining host-owned changes below are shared concerns that this host already
owns: the composed firewall list, the shared ACME reader group, and the host
DNS/rewrite shape.

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
  cluster_addr = "https://${vaultDomain}:8201"
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

If the host already has an AdGuard rewrite for `"*.apps.kilty.io"` to `myAddr`,
that covers both `secrets.apps.kilty.io` and `identity.apps.kilty.io` for LAN
clients. Keep the host-local mapping anyway when you want bootstrap commands run
on `mini` itself to use the same TLS name as every other client.

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
Read-only deployment tokens and break-glass runtime tokens cannot enable audit
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

## Step 5: Enable JWT For Machine Access

Enable the JWT auth method:

```bash
vault auth enable jwt
```

If this returns `permission denied`, TLS and routing are already working; the
current shell is just using a token that cannot manage `sys/auth/*`. Set
`VAULT_TOKEN` to the bootstrap root token from Step 2 or to another operator
token with `sudo` capability on `sys/auth/*`, then retry:

```bash
export VAULT_TOKEN='<generated-initial-root-token-or-admin-token>'
vault token lookup
vault auth enable jwt
```

Do not use `VAULT_SKIP_VERIFY=true` to solve `permission denied`. That setting
only bypasses certificate verification and does not grant Vault permissions.

Configure the issuer and audience model for your CI or workload identity
provider.

If `mini` is also the identity provider, make the issuer a real HTTPS name that
both Vault and deployment runners can reach. The reviewed shape is:

- issuer URL: `https://identity.apps.kilty.io/realms/deployments`
- Vault URL: `https://secrets.apps.kilty.io:8200`
- deployment audience: `deployments-vault`
- deployment client id: `deployment-runner`
- deployment role: `deploy-pleomino-read`

Run the identity provider on the shared host as an OIDC issuer. Keycloak is the
most practical default when the host itself needs to mint non-interactive
machine tokens because it supports confidential clients and client-credentials
token flows. Dex is lighter, but use it only when it brokers to another workload
identity source or when you add a reviewed non-interactive token-minting path.

The realm name is intentionally `deployments`, not the repository or product
name. If the project is renamed later, keep the issuer stable unless you are
also ready to update Vault's JWT config, the Vault role bindings, and every
deployment runner that mints tokens.

### Step 5A: Add Keycloak To The Existing Host Config

Host-level requirements for the identity provider:

- DNS for `identity.apps.kilty.io` points at the shared host.
- TLS for `identity.apps.kilty.io` is managed declaratively, like the Vault
  hostnames in this runbook.
- The OIDC issuer metadata is available at:
  `https://identity.apps.kilty.io/realms/deployments/.well-known/openid-configuration`
- The issuer's JWKS endpoint is reachable from Vault.
- Issued tokens use the exact issuer string
  `https://identity.apps.kilty.io/realms/deployments`.

Use the reviewed importable module from the repo checkout instead of copying
Keycloak service config into the private host file. In the current monolithic
host shape, keep the existing `services.nginx`, `security.acme`, AdGuard
rewrites, and `networking.firewall.allowedTCPPorts` expressions as the owners.
Import the identity-provider module once, configure
`deploymentHost.identityProvider` with its nginx, ACME, and firewall ownership
disabled, and add one host-owned vhost to the existing nginx `virtualHosts`
merge.

The `identityDomain` and `keycloakHttpPort` names below are the `let` bindings
added in Step 0. Do not add a second top-level
`services.nginx.virtualHosts.${identityDomain}` definition in this file; because
the host already defines `services.nginx = { virtualHosts = ...; };`, that would
collide during Nix evaluation. Instead, add the new manual vhost inside the
existing `virtualHosts = (...) // { ... };` expression:

```nix
{
  imports = [
    # Existing imports stay here.
    "${deploymentModulesRoot}/shared-host-identity-provider-module.nix"
  ];

  deploymentHost.identityProvider = {
    enable = true;
    hostname = identityDomain;
    keycloakHttpPort = keycloakHttpPort;
    databasePasswordFile = "/var/lib/deployment-host-secrets/keycloak-db-password";

    # The existing host file already owns nginx, ACME, and firewall ports.
    manageNginx = false;
    manageAcme = false;
    openFirewall = false;
  };

  services.nginx = {
    # Existing nginx settings stay here.

    virtualHosts = (
      # Existing serviceTcpPorts-generated vhosts stay here.
    ) // {
      # Existing manual vhosts stay here.

      "${identityDomain}" = {
        useACMEHost = "apps.kilty.io";
        onlySSL = true;
        locations."/" = {
          proxyPass = "http://127.0.0.1:${toString keycloakHttpPort}";
          proxyWebsockets = true;
          extraConfig = ''
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port 443;
            proxy_set_header X-Forwarded-Proto https;
          '';
        };
      };
    };
  };
}
```

The module enables Keycloak with a local PostgreSQL database, binds the HTTP
listener to `127.0.0.1`, and keeps the database password file as an out-of-store
path. It renders Keycloak's `hostname` setting as
`https://${identityDomain}` while keeping `identityDomain` as the bare nginx
virtual-host name; this is required because Keycloak requires a full URL when
`hostname-backchannel-dynamic` is enabled. It does not own nginx in this host
shape, set a bootstrap admin password, or commit client secrets; create those
through the Keycloak bootstrap/admin flow and rotate them immediately after
first use.

Do not also add `identity.apps.kilty.io` to the `security.acme.certs."apps.kilty.io".extraDomainNames`
list. The existing wildcard certificate for `*.apps.kilty.io` already covers
it, and duplicate exact names can make ACME reject the order. If the existing
AdGuard rewrites include `"*.apps.kilty.io"`, no additional DNS rewrite is
needed for the LAN path.

Before rebuilding, create the database password file on the host. Keep this file
out of git and replace this manual step with the host's reviewed secret
management system when one is available:

```bash
sudo install -d -m 0700 /var/lib/deployment-host-secrets
openssl rand -base64 36 \
  | sudo tee /var/lib/deployment-host-secrets/keycloak-db-password >/dev/null
sudo chmod 0600 /var/lib/deployment-host-secrets/keycloak-db-password
```

Apply the host configuration:

```bash
sudo nixos-rebuild switch --flake /etc/nixos#mini
```

Confirm that Keycloak and nginx are up:

```bash
systemctl status keycloak.service
systemctl status nginx.service
sudo ss -ltnp | grep ':8091'
```

Confirm the public issuer name resolves and serves OIDC metadata. The realm does
not exist yet, so a `404` here is acceptable before Step 5B; TLS and routing
errors are not:

```bash
getent hosts identity.apps.kilty.io
curl -I https://identity.apps.kilty.io/
```

### Step 5B: Create The Deployment Realm And Client

Sign in to the Keycloak admin console at:

```text
https://identity.apps.kilty.io/admin
```

Use the bootstrap admin account only long enough to create a real operator
account, rotate the bootstrap password, and configure the deployment realm.

Identity-provider configuration checklist:

1. Create a realm named `deployments`.
2. Create a confidential OpenID Connect client named `deployment-runner`.
3. Enable a non-interactive token flow for that client, such as client
   credentials.
4. Create a public OpenID Connect client named `deployment-cli` with
   Authorization Code + PKCE required for human deploys.
5. If SSH/headless human deploys are supported, enable device authorization for
   the realm or public client. If the issuer cannot support device
   authorization, operators will use the printed PKCE URL plus an SSH loopback
   tunnel.
6. Add an audience mapper so deployment tokens include
   `aud = "deployments-vault"`.
7. Add stable bound claims that Vault can check, such as:
   - `azp = "deployment-runner"`
   - `azp = "deployment-cli"` for human flows
   - `deployment_environment = "mini"`
   - `repository = "kiltyj/bucknix-fresh"`
   - a reviewed deployer group or role claim for human flows
8. Store the service-account client secret outside the repo, for example in the Jenkins
   credential store or the reviewed host secret store.

One practical Keycloak admin-console path is:

1. Open `Manage realms`, create the `deployments` realm, and switch into it.
2. Open `Clients`, create `deployment-runner`, and select the OpenID Connect
   client type.
3. Turn on `Client authentication`.
4. Turn on `Service accounts roles`.
5. Turn off browser-oriented flows unless they are needed for a reviewed human
   login path.
6. In the client credentials tab, copy the generated client secret into the
   Jenkins credential or host secret named by the deployment runner, such as
   `BNX_DEPLOYER_CLIENT_SECRET`.
7. In the client's dedicated client scope, add an `Audience` mapper with
   `Included Custom Audience` set to `deployments-vault`, and include it in the
   access token.
8. In the same scope, add a `Hardcoded claim` mapper for
   `deployment_environment` with value `mini`, JSON type `String`, and access
   token inclusion enabled.
9. Add another `Hardcoded claim` mapper for `repository` with value
   `kiltyj/bucknix-fresh`, JSON type `String`, and access token inclusion
   enabled.
10. Create `deployment-cli` as a public client, require PKCE, allow loopback
    redirect URIs for the CLI callback, and add a `groups` mapper for reviewed
    deploy auth sessions.

Reviewed Keycloak group conventions for claim-to-grant mapping:

- Human deployment-scoped grants come from:
  - `deploy-submitters-<project>-<env>`
  - `deploy-approvers-<project>-<env>`
  - `deploy-admission-reporters-<project>-<env>`
- Automation grants stay broader and are bound to a reviewed automation
  principal id such as `jenkins`:
  - `deploy-automation-<principal>-submitters-project-<project>`
  - `deploy-automation-<principal>-submitters-<env>`
  - `deploy-automation-<principal>-approvers-<env>`
  - `deploy-automation-<principal>-admission-reporters-project-<project>`
  - `deploy-automation-<principal>-admission-reporters-all-deployments`
- The deploy control plane derives a deterministic union of every reviewed grant
  that matches the deployment context; malformed or unrelated groups do not
  create implicit authorization.

The `repository` claim should match the current repository identity used by the
CI or deployment runner. If the repository is renamed, update that mapper and
the Vault role's `bound_claims` at the same time.

Before you create or troubleshoot groups by hand, inspect the reviewed shape
derived from deployment metadata:

```bash
deploy auth print-groups --deployment //projects/deployments/pleomino-dev:deploy
deploy auth explain-groups \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --action submit
deploy admin keycloak plan --deployment //projects/deployments/pleomino-dev:deploy
deploy admin keycloak sync \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --realm-file /srv/common/deployment-auth-realm.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-shape-admin-project-pleomino
deploy admin keycloak grant-user \
  --deployment //projects/deployments/pleomino-dev:deploy \
  --action submit \
  --user-email alice@example.com \
  --membership-file /srv/common/deployment-auth-memberships.json \
  --acting-principal <principal> \
  --admin-group deploy-admin-keycloak-membership-admin-project-pleomino
```

Those helpers keep group shape separate from membership. Ordinary read-only
`deploy auth ...` explains the expected shape; privileged `deploy admin ...`
applies reviewed changes. The generated `deployment-auth-realm.json` contains
reviewed group and mapper shape only. Human membership lives in the separate
reviewed `/srv/common/deployment-auth-memberships.json` input.

Deploy-admin Keycloak grants are intentionally distinct from ordinary deploy
grants. Typical reviewed examples are:

- `deploy-admin-keycloak-read-project-pleomino`
- `deploy-admin-keycloak-shape-admin-project-pleomino`
- `deploy-admin-keycloak-membership-admin-project-pleomino`
- `deploy-admin-keycloak-read-environment-dev`

After creating the realm, verify the issuer metadata:

```bash
curl -fsS \
  https://identity.apps.kilty.io/realms/deployments/.well-known/openid-configuration \
  | jq '{issuer, jwks_uri, token_endpoint}'
```

The reported `issuer` must be exactly:

```text
https://identity.apps.kilty.io/realms/deployments
```

For a low-level client-credentials smoke check, mint a test token through the
reviewed helper and inspect the claims before wiring Vault to it. This helper is
not the normal deployment handoff path. It discovers the token endpoint from
OIDC metadata, reads the client secret from the named environment variable,
writes the JWT with restrictive file permissions for the smoke check, and fails
closed if the expected issuer, audience, `azp`, or bound claims are missing:

```bash
export BNX_DEPLOYER_CLIENT_SECRET='<client-secret-from-keycloak>'

deploy-vault-jwt \
  --issuer https://identity.apps.kilty.io/realms/deployments \
  --client-id deployment-runner \
  --client-secret-env BNX_DEPLOYER_CLIENT_SECRET \
  --out /tmp/mini-workload.jwt \
  --audience deployments-vault \
  --expect-claim deployment_environment=mini \
  --expect-claim repository=kiltyj/bucknix-fresh \
  --print-claims
```

If the decoded token does not contain the exact issuer, audience, and bound
claims shown above, fix the Keycloak realm or client mappers before continuing.
Do not configure routine deploys to consume `/tmp/mini-workload.jwt`;
PR-73+ deploys use credential-source adapters and an in-memory Vault credential
context instead of JWT files.

The NixOS Keycloak module also supports `services.keycloak.realmFiles` for
declarative realm imports, and the reviewed shared-host wrapper exposes that as
`deploymentHost.identityProvider.realmFiles`. Use that wiring for
`deployment-auth-realm.json` once the shape is reviewed, but do not put
generated client secrets or bootstrap admin passwords in a realm JSON file that
will enter the Nix store.

### Step 5C: Point Vault At The `mini` Issuer

Then point Vault's JWT auth method at the real `mini` issuer:

```bash
vault write auth/jwt/config \
  oidc_discovery_url="https://identity.apps.kilty.io/realms/deployments" \
  bound_issuer="https://identity.apps.kilty.io/realms/deployments"
```

Use JWT auth when a CI job or deployment helper needs machine-to-machine access
to remote Vault without an interactive human login or a pre-minted Vault token.

## Step 6: Create A Least-Privilege Read Policy

Write a policy that allows the deployment runtime to read only the specific
deployment secrets it needs.

Prefer the generated policy HCL from `deploy --print-vault-bootstrap`. To print
only that reviewed HCL:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-bootstrap \
  --vault-bootstrap-format=hcl \
  --issuer-url https://identity.apps.kilty.io/realms/deployments \
  --vault-audience deployments-vault \
  --deployment-client-id deployment-runner \
  --vault-jwt-role deploy-pleomino-read \
  > deploy-pleomino-read.hcl
```

For the example deployment, the generated file is equivalent to:

```hcl
path "secret/data/deployments/pleomino/cloudflare_api_token" {
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

## Step 7: Create The Deployment Reader JWT Role

Create a JWT role that uses that read policy. Prefer the generated shell output
from `deploy --print-vault-bootstrap --vault-bootstrap-format=shell`; it derives
the repository claim from lane governance metadata and keeps the role binding
aligned with the deployment contract.

The generated role command has this shape:

```bash
vault write auth/jwt/role/deploy-pleomino-read \
  role_type="jwt" \
  bound_audiences="deployments-vault" \
  bound_claims='{"azp":"deployment-runner","deployment_environment":"mini","repository":"kiltyj/bucknix-fresh"}' \
  user_claim="sub" \
  token_policies="deploy-pleomino-read" \
  token_ttl="30m" \
  token_max_ttl="2h"
```

Example values and when to use them:

- `token_policies="deploy-pleomino-read"`
  Attach only the read policy created above.
- `bound_audiences="deployments-vault"`
  Require the workload JWT audience expected by deployment jobs.
- `bound_claims='{"azp":"deployment-runner","deployment_environment":"mini","repository":"kiltyj/bucknix-fresh"}'`
  Bind the role to reviewed workload identity claims. Use the provider's stable
  claims for the deployment client, environment, repository, project, service
  account, branch, or job identity.
- `user_claim="sub"`
  Use the workload subject as Vault's display identity for auditability.
- `token_ttl="30m"`
  Use a short-lived token for routine deployment runs.
- `token_max_ttl="2h"`
  Give enough time for one controlled deployment job without creating a long-lived
  credential.

The deployment environment supplies a signed workload JWT at runtime. Vault
validates issuer, audience, and bound claims before returning the short-lived
client token that the deployment helper keeps in memory.

## Step 8: Store Secrets In Vault

Store each deployment secret under the generated KV path using the generated
JSON templates. The helper fills in all non-secret metadata; operators replace
only `"<fill-me>"` with the real value before writing to Vault.

Generate or refresh the templates:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-vault-secret-templates \
  --vault-secret-template-format=files \
  > vault-secret-templates.txt
```

Create `cloudflare_api_token.json`:

```json
{
  "value": "<fill-me>",
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
  "value": "<fill-me>",
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

- `"value": "<fill-me>"`
  Replace this placeholder with the actual secret value immediately before the
  local Vault write. Do not commit the filled file.
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

## Step 9: Point Operators At The Hosted `mini` Deployment Service

The reviewed deployment runtime logs in to Vault's JWT auth endpoint itself.
For local/direct deploys, `deploy` mints the short-lived workload JWT just
before it needs Vault. For protected service-backed deploys, the laptop client
only completes the human authorization flow; the `mini` worker mints or reads
the workload JWT from server-local credential references and then activates the
typed in-memory secret context for provider execution. The deployment target
should declare stable Vault runtime metadata in `vault_runtime`, so routine
deploys do not need Vault or issuer exports on the laptop. Protected/shared
service submissions reject laptop Vault tokens, Vault JWT files, fixture secret
paths, client-side provider-token inputs, and client-supplied principals or
authorization grants.

Example deployment metadata:

```python
vault_runtime = {
    "addr": "https://secrets.apps.kilty.io:8200",
    "oidc_issuer": "https://identity.apps.kilty.io/realms/deployments",
    "audience": "deployments-vault",
    "cli_public_client_id": "deployment-cli",
    "service_account_client_id": "deployment-runner",
    "deployment_environment": "mini",
    "jwt_role": "deploy-pleomino-read",
    "pkce_callback_mode": "public_host",
    "pkce_callback_external_scheme": "https",
    "pkce_callback_external_host": "deploy-auth.apps.kilty.io",
    "pkce_callback_external_path": "/oidc/callback",
    "pkce_callback_bind_host": "127.0.0.1",
    "pkce_callback_bind_port": "7780",
    "pkce_callback_bind_path": "/oidc/callback",
    "preferred_credential_source": "interactive_pkce",
}
```

The deploy auth session may derive multiple reviewed grants from the same
token, for example `deploy-submitters-pleomino-dev` plus
`deploy-admission-reporters-pleomino-dev`, or automation groups such as
`deploy-automation-jenkins-submitters-dev` and
`deploy-automation-jenkins-admission-reporters-all-deployments`.

Credential-source choices:

- `interactive_pkce`: local human desktop deploys and reviewed shared-host
  submitter authorization. It authenticates the human request; it is not a
  worker Vault credential source for protected service-backed deploys. Configure
  a public Keycloak CLI client with Authorization Code + PKCE required. Allow
  loopback redirect URIs for local-only desktops and allow the exact shared-host
  redirect URI `https://deploy-auth.apps.kilty.io/oidc/callback` for `mini`.
- `interactive_device`: SSH/headless human deploys when the issuer supports
  OAuth 2.0 Device Authorization Grant. The CLI displays the verification URI
  and user code.
- `interactive_print_url`: SSH/headless fallback when device authorization is
  unavailable. The CLI prints the PKCE URL and loopback tunnel instructions
  instead of launching a browser on the server.
- `jenkins_client_secret`: Jenkins `withCredentials` Secret Text binding for a
  service-account client secret. The secret is visible only to the deploy front
  door, then converted into the in-memory Vault credential context.
- `jenkins_oidc` or `external_oidc_token`: Jenkins/workload-identity federation
  when Jenkins can provide an OIDC token from an issuer Vault trusts.

For the current `mini` host inventory:

| Purpose       | Hostname                     |
| ------------- | ---------------------------- |
| Deploy API    | `deploy.apps.kilty.io`       |
| OIDC issuer   | `identity.apps.kilty.io`     |
| Vault API     | `secrets.apps.kilty.io:8200` |
| PKCE callback | `deploy-auth.apps.kilty.io`  |

The deploy API and deploy-auth callback hostnames are host-owned nginx routes to
the long-running deployment service:

```nix
deploymentHost.deploymentService = {
  enable = true;
  hostname = "deploy.apps.kilty.io";
  localBindHost = "127.0.0.1";
  localBindPort = 7780;
  manageNginx = false;
  manageAcme = false;
  openFirewall = false;
};
```

```nix
deploymentHost.deployAuthCallback = {
  enable = true;
  hostname = "deploy-auth.apps.kilty.io";
  callbackPath = "/oidc/callback";
  localBindHost = "127.0.0.1";
  localBindPort = 7780;
  manageNginx = false;
  manageAcme = false;
  openFirewall = false;
};
```

Keep the service bind port off the public firewall for this reverse-proxied
shape. The normal interactive story is: the laptop asks `mini` for an auth
session through `https://deploy.apps.kilty.io`, opens the returned browser URL,
Keycloak redirects to
`https://deploy-auth.apps.kilty.io/oidc/callback`, and the deployment service
records only a redacted principal plus authorization evidence. The Keycloak
redirect allowlist uses only that external URI; the local service URL is private
host wiring.

For Jenkins client-secret automation, keep the client secret itself outside the
repo:

```bash
export BNX_DEPLOYER_CLIENT_SECRET='<deployment-runner-client-secret>'
unset VAULT_TOKEN
```

When `vault_runtime` omits a field, the defaults match the bootstrap examples in
this runbook:

- Vault audience: `deployments-vault`
- service-account client id: `deployment-runner`
- human public client id: `deployment-cli`
- client secret env var: `BNX_DEPLOYER_CLIENT_SECRET`
- external OIDC token env var: `BNX_DEPLOYMENT_OIDC_TOKEN`
- deployment environment claim: machine hostname, override with
  `BNX_DEPLOYMENT_ENVIRONMENT` or `--deployment-environment`
- Vault role: `deploy-<deployment-family>-read` when the deployment id ends in
  the stage name, otherwise `deploy-<deployment-id>-read`

Override deployment metadata only when your Vault or IdP setup intentionally
differs for a run:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --vault-audience deployments-vault \
  --deployment-client-id deployment-runner \
  --deployment-environment mini \
  --credential-source jenkins_client_secret \
  --deployment-client-secret-env BNX_DEPLOYER_CLIENT_SECRET \
  --vault-jwt-role deploy-pleomino-read
```

`deploy-vault-jwt` remains available for low-level smoke tests and debugging,
but routine deploys should let the deploy front door mint the workload JWT so
the token is always fresh.

The normal deploy runtime does not accept `BNX_VAULT_JWT` or
`BNX_VAULT_JWT_FILE` as ambient credential handoff. Credential-source adapters
may obtain short-lived JWT material from Jenkins or a human login flow, but
provider execution receives only the typed in-memory secret context.

The issuer URL, client id, audience mapper, and deployment-derived bound claims
must match the identity-provider configuration from Step 5 and the Vault role
from Step 7.

If JWT login fails, the deployment helper fails closed. Common causes are an
expired JWT, wrong audience, wrong issuer, missing role binding, rejected bound
claims, remote Vault connectivity, TLS trust, or DNS routing to the wrong Vault
endpoint.

### Jenkins Pipeline Credential Sources

Use Jenkins masking and disable shell tracing before invoking `deploy`. Do not
archive env dumps, workspace files containing token material, or debug traces
from these steps.

Client-secret minting with a Jenkins Secret Text credential:

```groovy
withCredentials([string(credentialsId: 'deployment-runner-client-secret', variable: 'JENKINS_DEPLOYMENT_CLIENT_SECRET')]) {
  sh '''
    set +x
    deploy \
      --deployment //projects/deployments/pleomino-prod:deploy \
      --credential-source jenkins_client_secret \
      --deployment-client-secret-env JENKINS_DEPLOYMENT_CLIENT_SECRET
  '''
}
```

External OIDC/workload-identity federation when Jenkins is configured as, or
can obtain a token from, an issuer trusted by Vault:

```groovy
withCredentials([string(credentialsId: 'jenkins-deployment-oidc-token', variable: 'JENKINS_OIDC_TOKEN')]) {
  sh '''
    set +x
    deploy \
      --deployment //projects/deployments/pleomino-prod:deploy \
      --credential-source external_oidc_token \
      --external-oidc-token-env JENKINS_OIDC_TOKEN
  '''
}
```

In both cases, bind Vault roles to repository, job/target, branch or
environment claims, and the expected Vault audience. Jenkins same-agent process
inspection can expose environment-bound credentials to other jobs running with
the same operating-system identity, so keep deploy agents dedicated or
otherwise isolated for protected environments.

For explicit break-glass or low-level tests, keep Vault tokens out of the
normal deploy environment and use a reviewed in-memory token credential path.
Do not use root tokens, long-lived Vault tokens, or reusable bootstrap
credentials for normal deployments.

## Step 10: Optional: Export The Secret Fixture From Vault

Skip this step for the normal production path. Production deployments should use
the Vault API directly through the JWT-first provider configuration above.

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

For local/direct production flows, leave `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`
unset. Human deploys normally use PKCE/device login without a deployment client
secret, and non-service provider execution receives only the typed in-memory
secret context:

```bash
unset BNX_DEPLOYMENT_SECRET_FIXTURE_PATH
unset VAULT_TOKEN
unset BNX_VAULT_JWT
unset BNX_VAULT_JWT_FILE
unset BNX_VAULT_AUTH_METHOD

deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --login-browser auto
```

For protected/shared `mini` deploys, use the hosted service path. The laptop
client authenticates to `mini`; it does not mint or forward Vault workload
credentials:

```bash
unset BNX_DEPLOYMENT_SECRET_FIXTURE_PATH
unset VAULT_TOKEN
unset BNX_VAULT_JWT
unset BNX_VAULT_JWT_FILE
unset BNX_VAULT_AUTH_METHOD

deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --profile mini
```

If you need to force one exact local build output for a protected/shared `mini`
run, pass it only as an artifact source for the service-backed workflow:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --profile mini \
  --artifact-dir ./dist
```

The reviewed client/profile path stages or uploads the artifact before
submission; `mini` admits or materializes the artifact and performs provider
mutation. Do not submit a laptop-local path directly to the hosted service.

Jenkins deploys to protected/shared `mini` should use the reviewed shared-host
wrapper and keep Vault credential material on `mini`:

```bash
unset BNX_DEPLOYMENT_SECRET_FIXTURE_PATH
unset VAULT_TOKEN
unset BNX_VAULT_JWT
unset BNX_VAULT_JWT_FILE
unset BNX_VAULT_AUTH_METHOD

nixos-shared-host-jenkins-deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --profile mini \
  --artifact-dir "$WORKSPACE/projects/apps/pleomino/dist" \
  --ssh-identity-file "$JENKINS_SSH_IDENTITY" \
  --ssh-known-hosts "$JENKINS_KNOWN_HOSTS"
```

Jenkins deploys for local/direct or CI-owned non-service flows should expose
only the selected Jenkins credential binding to the deploy front door:

```bash
export BNX_DEPLOYER_CLIENT_SECRET='<deployment-runner-client-secret>'
unset BNX_DEPLOYMENT_SECRET_FIXTURE_PATH
unset VAULT_TOKEN
unset BNX_VAULT_JWT
unset BNX_VAULT_JWT_FILE
unset BNX_VAULT_AUTH_METHOD

deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --credential-source jenkins_client_secret \
  --deployment-client-secret-env BNX_DEPLOYER_CLIENT_SECRET
```

For local/direct and CI-owned non-service flows, the deploy front door mints or
receives a fresh workload JWT from the selected credential source and
`vault_runtime`, keeps it in a typed in-memory deployment secret context, and
exchanges that JWT for a short-lived Vault token inside the secret resolver.
For protected/shared service deployments, keep those credential inputs on
`mini`; the laptop client submits to the hosted service and does not supply
Vault runtime credentials.

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

## Troubleshooting Auth Setup

Start with the read-only doctor:

```bash
deploy auth doctor --deployment //projects/deployments/pleomino-staging:deploy
```

Use the reported category to choose the next fix:

- IdP discovery unavailable or issuer mismatch:
  check `vault_runtime.oidc_issuer`, the IdP discovery document, and network
  access from the operator or Jenkins runner.
- Browser/device login denied, expired, or timed out:
  rerun login with `deploy auth print-login --deployment <label>` and complete
  the PKCE or device-flow prompt before the timeout.
- Vault JWT login rejected:
  compare the issuer, audience, role, group/role claim, and bound claim keys
  with `deploy auth explain-vault-role --deployment <label>`.
- Vault policy denied the requested secret path:
  verify the generated policy allows the exact `secret://...` contract path and
  target scope used by the deployment.
- Jenkins credential binding missing or out of scope:
  run `deploy auth print-jenkins-help --deployment <label>` and keep the
  `deploy` invocation inside the printed `withCredentials` block.
- CI attempted an interactive credential source:
  set `--credential-source jenkins_client_secret`, `jenkins_oidc`, or
  `external_oidc_token` and bind the matching environment variable.

All diagnostic output is redacted. It may show issuer URLs, Vault addresses,
audiences, role names, policy names, and claim names, but it must not show client
secrets, JWTs, Vault tokens, PKCE verifiers, device codes, auth codes, or
Jenkins-bound secret values.

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
- [JWT auth](https://developer.hashicorp.com/vault/docs/auth/jwt)
- [policy write](https://developer.hashicorp.com/vault/docs/commands/policy/write)
- [kv put](https://developer.hashicorp.com/vault/docs/commands/kv/put)
