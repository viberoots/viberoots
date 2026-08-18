# Tauri Mobile Target Design

This document proposes iOS and Android target support for the existing Rust `tauri_app` scaffold.
Current reviewed Tauri packaging remains limited to credential-free `aarch64-darwin` desktop `.app`
artifacts until this implementation and validation land.

## Current State

The current `tauri_app` route has one reviewed native artifact shape: public macro
`tauri_platform = "aarch64-darwin"`, generated `bundle.targets = ["app"]`, `cargo-tauri tauri build`,
a required macOS `.app` bundle with ad-hoc signature envelope, and a `desktop-app` runnable.

That contract is intentionally narrow. It keeps GUI packaging credential-free and avoids unreviewed
Apple or Android signing, store upload, device, simulator, Gradle, Xcode, or host SDK authority.

## Goals

- Let one scaffolded Tauri project declare desktop, iOS, and Android build targets explicitly while
  sharing the same Rust crate, frontend dist, Tauri config, resources, capabilities, icons, and
  reviewed app commands by default.
- Preserve Buck as graph, impact, and orchestration authority.
- Preserve Nix as toolchain, dependency, artifact, and sandbox authority where each platform allows.
- Keep generated mobile platform directories deterministic and source-owned.
- Separate unsigned local/simulator artifacts from release-signed store artifacts.
- Route mobile signing and store release evidence through deployment admission, not ambient env vars.
- Keep unsupported host/platform combinations fail-closed with actionable diagnostics.

## Non-Goals

- Do not make mobile support a hidden side effect of `tauri_app`.
- Do not use host Cargo, rustup, Node, Gradle, Android SDK, or Xcode as fallback authority.
- Do not claim App Store or Play Store release support from a local unsigned build.
- Do not introduce package-local shell hooks such as `beforeBuildCommand` or `beforeDevCommand`.
- Do not support arbitrary Tauri plugins in the first mobile slice.
- Do not make Linux or Windows desktop Tauri packaging part of this design.

## Public Macro Shape

Keep `tauri_app` as the compatibility macro for the current desktop target. Add explicit platform
macros for mobile and an optional aggregate helper:

```starlark
load("@viberoots//build-tools/rust:defs.bzl", "tauri_android_app", "tauri_ios_app", "tauri_mobile_suite")

tauri_ios_app(
    name = "demo_ios",
    crate = "demo",
    frontend_dist = ":frontend",
    tauri_config = "tauri.conf.json",
    ios_bundle_identifier = "dev.example.demo",
)

tauri_android_app(
    name = "demo_android",
    crate = "demo",
    frontend_dist = ":frontend",
    android_package = "dev.example.demo",
    android_min_sdk = 24,
    android_compile_sdk = 35,
)

tauri_mobile_suite(
    name = "demo",
    crate = "demo",
    frontend_dist = ":frontend",
    tauri_config = "tauri.conf.json",
    targets = ["desktop-darwin", "ios", "android"],
)
```

`tauri_mobile_suite` may generate `:<name>_desktop`, `:<name>_ios`, and `:<name>_android` siblings,
all backed by the same source inputs unless a platform-specific override is declared. It must not
hide per-platform artifacts; only signed release-admitted mobile targets may become deployment
inputs.

## Platform Model

The graph should carry a typed `tauri_target` record instead of overloading string labels:

```json
{
  "family": "tauri",
  "platform": "ios",
  "artifactKind": "ios-simulator-bundle",
  "bundleIdentifier": "dev.example.demo",
  "signingMode": "unsigned-local"
}
```

| Platform         | Local artifact kinds   | Release artifact kinds                              |
| ---------------- | ---------------------- | --------------------------------------------------- |
| `desktop-darwin` | `macos-app`            | future `macos-signed-dmg`                           |
| `ios`            | `ios-simulator-bundle` | future `ios-unsigned-archive`, `ios-signed-ipa`     |
| `android`        | `android-debug-apk`    | future `android-unsigned-aab`, `android-signed-aab` |

The first implementation should support local/simulator artifacts only. Release artifact kinds are
reserved until signing, SBOM, provenance, and store deployment admission are wired.
Android debug APKs must use `signingMode = "debug-local"` with a deterministic, non-secret debug
signing authority emitted by Nix; they are forbidden as store deployment inputs. Unsigned iOS
archives and Android AABs are reserved until signed-artifact admission rejects them as deployable
inputs and binds them to later release-lane signing evidence.

The typed record must be transported through the existing Buck-to-Nix route rather than stored only
as documentation. Implementation must use Tauri-scoped public args or macro-specific allowed-arg
validation, reject mobile fields on non-Tauri Rust macros, and thread accepted fields through
`tauri_rule_attrs`, `prepare_tauri_contract`, `rust-kind-config.nix`, `planner/rust-tauri.nix`,
`graph-generator.nix`, and `manifest.nix`; unsigned archives and debug/simulator artifacts must not
publish `run.prod`.

## Source Layout

The scaffold should keep one Tauri root and one shared app source tree. Desktop, iOS, and Android
default to the same Rust crate, frontend target, `tauri.conf.json`, resources, capabilities, icons,
permissions, and app commands. Platform files live beside that root as `mobile/android.config.json`,
`mobile/ios.config.json`, and, only if needed, normalized `gen/mobile/android/**` or
`gen/mobile/ios/**` sources. Add explicit Buck attrs such as `android_config`, `ios_config`,
`android_project_srcs`, and `ios_project_srcs`; validate them as package-relative, include them in
`srcs` and `tauri_action_inputs`, and thread them through the planner contract. `gen/mobile/**`
becomes tracked source only if a pinned-CLI double-generation diff proves it cannot be regenerated
hermetically.
Non-deterministic files must be normalized by a reviewed generator or rejected from the first slice.

## Nix Tool Authority

Add reviewed Nix packages for `cargo-tauri`, Rust targets, Android SDK/NDK/Build Tools/platform
tools, Java, Gradle, Android Gradle plugin dependencies, and iOS Xcode/Apple SDK authority. Android
may use a Gradle wrapper only if the wrapper jar, distribution, plugin dependencies, and cache are
fixed-output or Nix-provided and offline. iOS authority must name the accepted Xcode discovery
source, version/build allowlist, `xcrun`/`xcodebuild`/`simctl` invocation path, and the reviewed
values passed into Nix. Use `rcodesign` or platform-native unsigned inspection tools where
applicable.

Builds must use a deny-by-default scrub before derivation setup, then set only an allowlist of
reviewed Nix-emitted values. The scrub covers Android, Gradle, JVM, Xcode, Apple signing, Tauri,
Cargo, Rust, rustup, fastlane, and match override families, including `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, `ANDROID_NDK_HOME`, `ANDROID_NDK_ROOT`, `NDK_HOME`, `ANDROID_USER_HOME`,
`ANDROID_AVD_HOME`, Android cache variables, `JAVA_HOME`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`,
`JDK_JAVA_OPTIONS`, `GRADLE_USER_HOME`, `GRADLE_OPTS`, `ORG_GRADLE_PROJECT_*`, `XCODE_*`,
`DEVELOPER_DIR`, `SDKROOT`, `TOOLCHAINS`, `MACOSX_DEPLOYMENT_TARGET`, iOS deployment-target
variables, `APPLE_*`, `CODE_SIGN_*`, `DEVELOPMENT_TEAM`, `PROVISIONING_PROFILE*`, `MATCH_*`,
`FASTLANE_*`, `TAURI_*`, `CARGO_*`, `RUSTC`, `RUSTFLAGS`, and `RUSTUP_HOME`. If a required SDK
cannot be provided from Nix on the current host, the target fails during planning with a message that
names the missing reviewed tool authority.
`HOME`, XDG cache/config/data dirs, and temp dirs must be fixed Nix-owned scratch paths so tools
cannot fall back to poisoned user caches such as `~/.gradle`, `~/.android`, or `~/.cargo`.

## Build Contracts

Split `build-tools/tools/nix/templates/rust-tauri.nix` into small platform-specific modules:

- `rust-tauri-common.nix`: shared config, frontend, CSP, capability, resource, icon, sidecar, and
  app-command validation;
- `rust-tauri-darwin-desktop.nix`: existing `.app` behavior;
- `rust-tauri-ios.nix`: iOS simulator behavior;
- `rust-tauri-android.nix`: Android APK/AAB behavior.

The common module must keep the existing offline frontend policy:

- `frontendDist` is replaced only with the Buck-built frontend artifact;
- build/dev hooks remain forbidden;
- arbitrary plugins remain forbidden until a plugin contract exists;
- capabilities and permissions must exactly match declared app windows and commands;
- resource, icon, and sidecar mappings stay package-relative and duplicate-free.

The Android local artifact root should contain `app.apk`,
`share/viberoots-tauri/artifact-manifest.json`, Gradle evidence, package name, SDK levels, ABI list,
and signing mode. The iOS local artifact root should contain a simulator `app.app`, the same manifest
path, Xcode build settings evidence, bundle identifier, SDK, destination, architectures, and signing
mode. Unsigned AAB and iOS archive roots are release-lane inputs only after PR-6-style admission
exists.

## Signing And Release Admission

Local mobile targets start as unsigned or simulator-only. They may not read:

- Apple certificates, App Store Connect keys, provisioning profiles, team secrets, or passwords;
- Android keystores, key passwords, Play service account JSON, or upload credentials.

Release signing should be an external release-lane/admission phase, not a normal `b` build:

- metadata-only admission targets consume unsigned hermetic artifacts plus reviewed signing evidence
  refs and retained exact signed outputs from protected release jobs;
- no Buck, Nix, Cargo, or Tauri local build action reads signing secrets;
- App Store Connect and Google Play deployment targets consume only signed mobile artifacts with
  matching `mobile-app` component metadata.

This matches the existing deployment provider model for `app-store-connect` and `google-play`
without letting the build macro become a store publisher.

The signed `mobile-app` artifact manifest must record platform, bundle/package id, signing model,
signer identity, `releaseSigned`, `releaseAdmitted`, SBOM/provenance refs, unsigned-input digest,
signed-output digest, and verification result. Provider admission must parse this manifest, match it
against provider target fields, and reject extension-only `.ipa` or `.aab` evidence.

## Runnable And Test Manifests

The planner manifest should publish platform-specific runnable kinds:

- `desktop-app` for current macOS desktop;
- `ios-simulator-app` for iOS simulator launch;
- `android-emulator-app` for Android emulator launch;
- no `run.prod` for unsigned store artifacts.

Simulator and emulator launchers must be explicit dev/test runners with manifest timeout fields,
host-capability evidence for virtualization or Xcode Simulator availability, and `run-runnable`
enforcement that rejects unbounded or production mobile runnables.

## Scaffolding Changes

Extend `build-tools/tools/scaffolding/templates/rust/tauri-app` with `targets`, mobile bundle/package
identity, Android SDK levels, iOS deployment target, and `include_mobile_release_placeholders`
defaulting to `false`. The template must emit shared-source `TARGETS`: one crate, frontend, config,
resource set, and capability set feed desktop, iOS, and Android labels unless a reviewed platform
override is present.

The default scaffold remains desktop-only until mobile contracts and focused validation exist.
Requested mobile `TARGETS` use explicit `tauri_ios_app` and `tauri_android_app` labels rather than
changing the existing desktop label.

## Validation Plan

Add focused coverage before enabling mobile scaffolds by default: macro cquery tests; route inventory
updates; negative cquery tests for unsupported platforms, signing secrets, escaping paths, wildcard
capabilities, duplicate resources, unreviewed plugins, and identifier drift; planner Nix-eval tests;
SDK-supported fixture builds; hostile-env stripping tests; manifest tests proving mobile runnables
are not `run.prod`; and deployment tests proving stores accept only signed `mobile-app` artifacts.

Full-suite validation is not enough for mobile enablement. Include one fresh temp-consumer scaffold
smoke for each enabled mobile target.

## Migration Plan

1. Introduce typed Tauri target metadata and keep `tauri_app` behavior unchanged.
2. Split the current desktop Nix template into common and desktop modules with no behavior change.
3. Add Android local artifact builder support while keeping scaffold opt-in gated.
4. Add iOS simulator artifact builder support while keeping scaffold opt-in gated.
5. Add runnable manifest entries for emulator/simulator development.
6. Add release-signing artifact contracts without store upload.
7. Connect signed mobile artifacts to existing App Store Connect and Google Play deployment targets.
8. Enable reviewed mobile scaffold opt-in and reassess whether `tauri_mobile_suite` should become the
   default scaffold once evidence exists.

## Open Questions

- Can the pinned Tauri CLI generate Android and iOS project directories deterministically?
- Which Android SDK and NDK versions should become the first reviewed Nix authority?
- Should the first iOS slice support simulator only, or also unsigned device archives?
- How should sidecars map on mobile?
- Do real mobile apps need a narrow reviewed Tauri plugin contract?
- Which host-capability probes skip as unsupported versus fail as misconfigured?
