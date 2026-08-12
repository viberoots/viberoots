# Rust Tauri Development

`tauri_app` is the experimental desktop-application route. Current reviewed native packaging and
launch evidence is limited to `aarch64-darwin`.

The application owns canonical Cargo metadata, `tauri.conf.json`, Rust sources, capability and
permission files, and declared resources. `tauri_root` is bounded to `.` or `src-tauri`; Cargo,
config, capability, permission, icon, and resource paths remain inside that root. Its frontend is a separate Buck target, normally
`node_webapp` followed by `node_asset_stage`, and is passed through `frontend_dist`. Do not add
`beforeBuildCommand` or `beforeDevCommand`; the planner rejects hidden build authorities.
Frontend code imports pinned module paths such as `@tauri-apps/api/core`. The global Tauri object is
disabled.

Use `b //<package>:<target>` to produce a credential-free executable, `.app` bundle, and
`viberoots.tauri-artifact.v1` manifest. Use `p` to execute the built production binary. Use `d` for
the explicit bounded Tauri watcher, which rebuilds the selected production route when package
sources, frontend files, config, capabilities, or resources change and terminates the prior process
group before restart.

Native C and C++ code stays behind `rust_c_ffi_library` or `rust_cxx_bridge_library` and a matching
Cargo path dependency. `app_commands` and `app_windows` declare the allowed universe. Command names
use conservative Rust/Tauri identifiers. Every configured window has one unambiguous capability
owner, while each capability grants only its exact subset of declared command permissions and may
grant none. Undeclared windows or commands, plugin/future permissions, wildcards, duplicates, and
ambiguous window coverage are rejected. Reviewed command permission TOML files are declared through
`permissions`. Each file is parsed as TOML and must contribute an exact one-to-one
`allow-<command>` identifier and single `commands.allow = ["<command>"]` mapping. Extra, denied,
wildcard, duplicate, or mismatched commands are rejected. Reviewed sidecars are separate `kind:bin`,
`sidecar:reviewed` targets listed in `sidecar_deps`. Resources and sidecars use explicit
`{"src": ..., "dest": ...}` mappings with unique, package-relative bundle destinations. WebAssembly reaches the desktop frontend through the existing Node module-surface
and `node_asset_stage` contract; `tauri_app` has no second raw WASM input.

Apple Silicon requires the executable's linker-generated ad-hoc platform envelope in order to
launch it. The manifest records this as `adhoc-platform`, with no credential, team, or signing
identity and with both release signing and release admission false. Credentialed signing,
notarization, remote CSP origins, updater or plugin admission, and Linux platform promotion remain
outside this deterministic construction route.

The protected reproducibility lane has a dedicated `rust-tauri-darwin-pr12` case. It builds the
credential-free scaffold on two independent `aarch64-darwin` builders and requires identical Nix
and semantic artifact identities before the signed aggregate may record the case. Rust's other
PR-12 cases cover the native, extension, bridge, and WASM families on their declared systems.
Missing builder records, unsigned aggregate evidence, local-development bundles, untracked inputs,
development overrides, impure evaluation, or an unsupported system fail before protected cache or
publication admission.

For this protected case only, `behavior_probe = True` observes the frontend WASM recovered from the
packaged `.app`; it first requires the path and SHA-256 digest bound by the Tauri artifact manifest,
then invokes the reserved `viberoots_observed_behavior` export with the pinned WASM runtime.
Baseline/restored fixtures must return `42` and the reviewed patched fixture must return `43`.
Arbitrary commands, unpackaged frontend inputs, digest overrides, and other values are rejected.
Ordinary `tauri_app` targets leave the probe disabled.

This repository does not turn the ad-hoc application into a signed release. A reviewed external
lane must sign the already qualified deterministic application, notarize or otherwise admit it for
the target platform, retain provenance and SBOM evidence, and prove the signed result refers to the
qualified input without placing credentials or nondeterministic signed bytes inside its Nix
identity. The repository accepts that result only through `admit-tauri-release.ts`, which copies
and verifies the signed aggregate, release policy, external record, qualified output, and SPDX
document with the canonical protected-store verifier before parsing them. It hashes the exact
semantic-manifest and SPDX bytes from their immutable store paths; the source revision, provenance,
reviewed signer, signed artifact, and reviewed notary ticket must then agree with the qualified
unsigned identity. Candidate qualification while Rust is experimental is always rejected for
release admission. Until release administration retains real evidence, the manifest remains
`releaseSigned:false`, Rust stays experimental, and no signed-release claim is enabled; contract
fixtures are not product signing evidence.

For backout, disable the signing or publication job and retain both independent-builder records,
the signed aggregate, and the rejected external evidence. Correct the declared input, platform, or
signing authority and rerun the complete case. Do not publish one builder's output, reinterpret the
ad-hoc envelope as a release signature, or add signing credentials to Cargo, Tauri, Buck, Nix, or
the application bundle.

An application that stores its own credentials in macOS Keychain should not repeatedly ask the user
to authorize access in a shipped build. That guarantee requires a stable code-signing identity and
designated requirement. For Keychain items and APIs that support explicit access control, migrate
the existing item's narrowly scoped ACL to that identity; do not solve it by granting broad access.
`kSecAttrAccess` does not apply to synchronizable or data-protection-Keychain items, so consumers
must use the migration supported by their storage API. The current credential-free platform-ad-hoc
package does not claim a stable product identity, so product-specific Keychain migration belongs to
consumer adoption and the reviewed external signing/notarization lane.

The default scaffold also generates `<name>-test`. Fresh flake-input and submodule lifecycle tests
exercise `u`, read-only `i`, `b`, targeted `v`, and the exact packaged application through `p`.
There is no separate `r` command; `p` is the production-runnable front door.
