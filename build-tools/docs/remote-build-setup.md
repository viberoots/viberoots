## Remote Nix Builds — Setup Guide

This guide explains how to enable remote Nix building and binary caching for this repository. It covers developer machines and CI, what needs to be configured, and how this integrates with our Buck2 + Nix dynamic-derivation design.

### What you gain

- **Faster builds for everyone**: heavy artifacts are built once on remote builders and pulled from a binary cache.
- **Determinism across machines**: the same inputs produce identical outputs, regardless of host OS/CPU.
- **Precise reuse**: cache keys reflect our exact inputs (patch files, GOOS/GOARCH/tags, toolchains), so only relevant artifacts rebuild.

### Concepts (quick)

- **Remote builders**: Machines that perform builds over SSH for your local `nix-daemon`. Your machine uploads inputs; the remote machine builds and returns store paths.
- **Binary cache (substituters)**: A shared blob store (e.g., Cachix/Hydra) holding build outputs, so other machines can download instead of rebuilding.
- **Our design**: Buck decides impact; Nix performs per‑target builds via dynamic derivations. If Nix is configured with remote builders and substituters, those are used automatically whenever `nix build` runs (locally or in CI).

---

## Prerequisites & policy

- **Nix version**: 2.18+ recommended.
- **Enable features** (client and builders):
  - Required by current build implementation: `nix-command`, `flakes`
  - Optional policy features (org/CI choice): `dynamic-derivations`, `recursive-nix`, `ca-derivations`
- **Our repo conventions**:
  - Startup-check enforces implementation-required features (`nix-command`, `flakes`).
  - CI may enforce additional policy features independently of startup-check.
  - Unset `NIX_GO_DEV_OVERRIDE_JSON` before sharing caches (local overrides change derivation hashes and are forbidden in CI).

Example snippets for `nix.conf` (see OS‑specific locations below):

```conf
experimental-features = nix-command flakes
```

Locations:

- macOS (multi-user): `/etc/nix/nix.conf`
- Linux (multi-user): `/etc/nix/nix.conf`
- (Single-user installs: `$HOME/.config/nix/nix.conf`, but multi-user is strongly recommended.)

---

## Step 1 — Set up a binary cache (substituters)

You can use Hydra/S3 or a managed service like Cachix. The simplest path is Cachix.

1. Install and configure on developer machines:

```bash
nix profile install nixpkgs#cachix
cachix use <your-cache-name>
```

This adds entries to `nix.conf` similar to:

```conf
substituters = https://cache.nixos.org https://<your-cache-name>.cachix.org
trusted-public-keys = <your-cache-name>.cachix.org-1:<PUBKEY> cache.nixos.org-1:6NCH... (etc)
```

2. Configure CI to push:

- Provide the signing key as a secret in CI (do not commit keys to the repo).
- After successful builds, push to the cache:

```bash
cachix push <your-cache-name> $(nix path-info --all)
```

Tip: For large pipelines, prefer targeted `nix copy` (see “Step 4 — Push results from CI”).

---

## Step 2 — Configure remote builders (client side)

Your machine (client) can delegate builds to remote hosts via `builders`. You can specify them in `nix.conf` or an external machines file.

Option A: inline in `nix.conf`:

```conf
builders = ssh-ng://builder1.example.com x86_64-linux / - 8 1 big-parallel,benchmark,allow-import-from-derivation;
           ssh-ng://builder2.example.com aarch64-linux / - 8 1 big-parallel
builders-use-substitutes = true
max-jobs = 0  # build nothing locally; delegate to builders
```

Option B: reference a file:

```conf
builders = @/etc/nix/machines
builders-use-substitutes = true
max-jobs = 0
```

Then `/etc/nix/machines` could contain lines like:

```text
ssh-ng://builder1.example.com x86_64-linux / - 8 1 big-parallel,benchmark,allow-import-from-derivation
ssh-ng://builder2.example.com aarch64-linux / - 8 1 big-parallel
```

Notes:

- Use `ssh-ng://` (new protocol) for better performance.
- The third column (`/`) is the remote store path (usually `/`).
- The two numbers are the job limits per host.
- The trailing list declares host capabilities.
- Ensure passwordless SSH from the client to the builder user, and that `nix-daemon` runs on both ends.

macOS specifics:

- You can remote‑build Linux artifacts from macOS by delegating to a Linux builder with the matching `system` string (e.g., `x86_64-linux`).
- For Go builds, cross‑compilation and platform tags are captured by the derivation; the remote host compiles natively for its architecture.

---

## Step 3 — Prepare each builder host

On each builder:

1. Install Nix (multi-user) and enable `nix-daemon`.
2. Set `experimental-features` to include at least: `nix-command flakes`.
3. Ensure the builder user has SSH access and is allowed in `nix.conf` (e.g., `trusted-users = root <builder-user>` if needed).
4. Keep the builder’s Nixpkgs pinned or allow flake‑provided inputs; consistency across builders improves cache hits.
5. Ensure adequate disk, CPU, and RAM; set `systemd` limits if applicable.
6. (Optional) Set `nix.sandbox = true` for stronger isolation.

Connectivity test (from client):

```bash
nix store ping --store ssh-ng://builder1.example.com
```

---

## Step 4 — Push results from CI to the binary cache

We already build Nix artifacts in CI (see `Jenkinsfile` “Build graph-generator (Nix)”). To share results:

- Preferred (generic):

```bash
# Push only newly built outputs (example target shown)
nix build .#graph-generator --accept-flake-config
nix copy --to 'https://<cache-endpoint>' $(nix path-info .#graph-generator)
```

- Python wheelhouse (uv2nix) example:

```bash
# Build and push all wheelhouse outputs for importers with uv.lock
node build-tools/tools/ci/run-stage.ts --stage wheelhouse-preload --to 'https://<cache-endpoint>'
# Equivalent (manual): discover attributes, then copy their closures
nix build .#py-wheelhouse-apps-foo .#py-wheelhouse-libs-bar --accept-flake-config
nix copy --to 'https://<cache-endpoint>' $(nix path-info .#py-wheelhouse-apps-foo .#py-wheelhouse-libs-bar)
```

- Cachix (convenient):

```bash
cachix push <your-cache-name> $(nix path-info .#graph-generator)
```

Add the copy/push step after Nix build stages. Keep signing keys as CI secrets.

---

## How this integrates with our repo

- **Per-target builds via Nix**: Our flake exports dynamic-derivation planners (e.g., `.#graph-generator`) that Nix builds. When remote builders and substituters are configured globally, they’re picked up automatically for these builds.
- **Hermetic inputs are captured**: The flake pins inputs and snapshots the working tree via `builtins.path`; remote builders receive exactly the files our derivations declare.
- **Patches and overrides**: Patch files under `patches/<lang>/**` are treated as inputs and drive invalidation/caching. Local dev overrides (`NIX_GO_DEV_OVERRIDE_JSON`) must be unset in CI and before pushing to caches.
- **Buck integration**: Buck orchestrates what to build/test; when Nix builds are invoked (directly or via our scripts), remote Nix infra handles distribution and caching under the hood.

No repository changes are strictly required to use remote builders and caches. However, you may optionally:

- Add CI steps to `nix copy`/`cachix push` after successful Nix builds.
- Document/cache keys and substituters for your organization.

### Developer hydration of wheelhouse (offline local builds)

After CI publishes wheelhouse artifacts, developers can hydrate locally and build offline:

```bash
# Pull wheelhouse closures locally (example cache URL)
nix copy --from 'https://<cache-endpoint>' $(nix path-info .#py-wheelhouse-apps-foo)

# Then build Python envs offline (no network)
nix build .#py-apps-foo --offline --accept-flake-config
```

---

## Developer quickstart

1. Enable features locally (macOS/Linux):

```bash
sudo mkdir -p /etc/nix
sudo tee -a /etc/nix/nix.conf >/dev/null <<'CONF'
experimental-features = nix-command flakes
builders-use-substitutes = true
max-jobs = 0
CONF
```

2. Add builders:

```bash
sudo tee /etc/nix/machines >/dev/null <<'MACH'
ssh-ng://builder1.example.com x86_64-linux / - 8 1 big-parallel
ssh-ng://builder2.example.com aarch64-linux / - 8 1 big-parallel
MACH

sudo sed -i.bak 's|^builders =.*$|builders = @/etc/nix/machines|' /etc/nix/nix.conf || true
sudo launchctl kickstart -k system/org.nixos.nix-daemon 2>/dev/null || sudo systemctl restart nix-daemon || true
```

3. Use a shared cache (Cachix example):

```bash
nix profile install nixpkgs#cachix
cachix use <your-cache-name>
```

4. Smoke test:

```bash
direnv allow || true
node build-tools/tools/dev/startup-check.ts
nix build .#graph-generator --accept-flake-config --rebuild
```

You should see remote activity (SSH sessions to builders) and subsequent runs should fetch from your substituter.

---

## CI notes (Jenkins)

- Ensure agents have `/etc/nix/nix.conf` set with the features above and either `builders = ...` or `builders = @/etc/nix/machines`.
- Add a post‑build step to push to your binary cache (see Step 4). For example, after the “Build graph-generator (Nix)” stage, run:

```bash
# Example: push only the graph-generator closure
nix copy --to 'https://<cache-endpoint>' $(nix path-info .#graph-generator)
# or
cachix push <your-cache-name> $(nix path-info .#graph-generator)
```

- Keep signing keys in Jenkins credentials; inject them per stage.

---

## Troubleshooting

- **startup-check fails for Nix features**: Align your `nix.conf` with implementation-required features (`nix-command flakes`).
- **Remote builder never used**: Ensure `max-jobs = 0` (to avoid local builds) and `builders-use-substitutes = true`. Confirm SSH access and `nix-daemon` on the builder.
- **Poor cache hits between hosts**: Enable `ca-derivations` on both client and builders; ensure identical flake inputs; avoid local overrides.
- **macOS notarization warnings**: Not relevant to Nix store binaries, but some CI uploaders may need signing—configure per your org’s policy.
- **Large downloads**: Consider enabling store optimization and compression on the cache; use fast networks on builders.

---

## FAQ

- **Do we need repo changes to use remote Nix builds?**
  - No. Configure Nix on clients/builders/CI; our current flake and dynamic-derivation design already cooperate with remote builds and caches.

- **Which cache should we rely on?**
  - Nix binary caches for heavy artifacts. Buck’s cache can remain enabled for small Buck‑native steps, but Nix is authoritative for our build outputs.

- **Will dev overrides poison the cache?**
  - They change derivation hashes. CI forbids them; unset `NIX_GO_DEV_OVERRIDE_JSON` before pushing builds to the shared cache.
