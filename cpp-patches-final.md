## C++ Patching — Convention-Only Overlay (Option B)

This document specifies a convention-driven C++ patching system with no JSON mapping, mirroring the ergonomics used for Go patches while fitting nixpkgs-backed C++ libraries. Another engineer can implement this design directly.

### Goals

- One top-level UX for patches: `patch-pkg <subcommand> cpp <attr>` (unchanged)
- No generated JSON; overlay discovers patches by filename convention
- Deterministic, idempotent, low-merge-churn
- Robust by filtering patches to the current nixpkgs version when available

### Scope and assumptions

- Patches target nixpkgs attributes (e.g., `pkgs.zlib`, `pkgs.openssl`, `pkgs.gnome.glib`)
- Attribute segments do not contain literal “.” (safe to split)
- We do not maintain backwards compatibility with prior flattened filenames
- Overlays are included conditionally by `flake.nix` (already wired)

---

## Naming and encoding

We adopt the same double-underscore path encoding used for Go, applied to a normalized attr path:

- Normalize attr path to a slash path by replacing dots with slashes
  - Example: `pkgs.gnome.glib` → `pkgs/gnome/glib`
- Encode using the Go-style rule: `/` → `__`
  - `pkgs/gnome/glib` → `pkgs__gnome__glib`
- Filename schema:
  - `patches/cpp/<ENCODED_ATTR>@<VERSION>.patch`
  - Example: `patches/cpp/pkgs__zlib@1.2.13.patch`

Decoding (for the overlay):

- Extract `<ENCODED_ATTR>` and `<VERSION>` from the filename
- Decode `ENCODED_ATTR`: `__` → `/`, then `/` → `.` → `pkgs.<path>`
- Strip `pkgs.` to address `prev.<name>` when overriding

Notes:

- We assume segments will not contain literal `.`; `__` occurring in segments is acceptable as a literal because this encoding is only applied to separators introduced by our normalization step.

---

## Overlay implementation (pure Nix)

We replace any hand-maintained overlay with a tiny, stable overlay that scans `patches/cpp/*.patch`, decodes the attr/version, filters to the current nixpkgs version, and applies patches via `final.applyPatches`. Only this file needs to be committed; no generated JSON.

- File: `build-tools/tools/nix/overlays/cpp-patches.nix`
- Included by `flake.nix` when present (already implemented)

Behavior:

1. Enumerate `patches/cpp` at evaluation time using `builtins.readDir` if it exists.
2. Parse filenames that end with `.patch` and contain a single `@` suffix for version.
3. Decode `ENCODED_ATTR` to `pkgs.<path>` and derive `<name>` = tail after `pkgs.`.
4. Lookup `prev.<name>`; if it exists, read `prev.<name>.version` when available.
5. Filter patches for that `<name>` to those whose `<VERSION>` equals the current nixpkgs version for `<name>`. If `version` is absent, include all patches (best effort).
6. Apply patches in deterministic order per `<name>` and override `src` via `overrideAttrs`.

Reference overlay:

```nix
# build-tools/tools/nix/overlays/cpp-patches.nix
final: prev:
let
  root = ../../..;                           # repo root relative to this file
  patchDir = root + "/patches/cpp";
  exists = builtins.pathExists patchDir;
  dir = if exists then builtins.readDir patchDir else {};

  isPatch = n: builtins.match ".*\\.patch" n != null;
  # split "<enc>@<ver>.patch" into { enc, ver }
  parse = n:
    let base = builtins.replaceStrings [".patch"] [""] n;
        idx = builtins.stringLength base - builtins.stringLength (builtins.elemAt (builtins.split "@" base) ((builtins.length (builtins.split "@" base)) - 1)) - 1;
    in if builtins.match ".*@.*" base == null then null else {
      enc = builtins.substring 0 idx base;
      ver = builtins.substring (idx + 1) (builtins.stringLength base - idx - 1) base;
    };

  # Decode: "pkgs__gnome__glib" -> "pkgs.gnome.glib"
  decodeAttr = enc:
    let slash = builtins.replaceStrings ["__"] ["/"] enc; in
    builtins.replaceStrings ["/"] ["."] slash;

  # Build { name -> [ patchPaths ] } where name is the nixpkgs attr without the pkgs. prefix
  collect =
    let names = builtins.attrNames dir; in
    builtins.foldl' (acc: file:
      let info = builtins.getAttr file dir; in
      if (info == "regular") && (isPatch file) then
        let p = parse file; in
        if p == null then acc else
          let attrFull = decodeAttr p.enc; in
          if !(builtins.hasPrefix "pkgs." attrFull) then acc else
          let name = builtins.replaceStrings ["pkgs."] [""] attrFull;
              arr = if builtins.hasAttr name acc then acc.${name} else [];
              new = arr ++ [ { path = patchDir + "/" + file; ver = p.ver; } ];
          in acc // { ${"\""} + name + ${"\""} = new; }
      else acc
    ) {} names;

  # For each name: filter to patches matching current version (if known), stable sort, apply
  applyPatchesFor = name: entries:
    let
      have = builtins.hasAttr name prev;
      curVer = if have && (builtins.hasAttr "version" (builtins.getAttr name prev))
               then (builtins.getAttr name prev).version else null;
      keep = if curVer == null then entries
             else builtins.filter (e: e.ver == curVer) entries;
      # stable sort by path (string)
      sorted = builtins.sort (a: b: a.path < b.path) keep;
      files = map (e: builtins.toPath e.path) sorted;
      patched = if have && (files != []) then final.applyPatches {
        name = "cpp-patched-${name}";
        src = (builtins.getAttr name prev).src;
        patches = files;
      } else null;
    in if patched == null then {} else {
      ${"\""} + name + ${"\""} = (builtins.getAttr name prev).overrideAttrs (old: { src = patched; });
      ${"\""} + name + "_patched_src" + ${"\""} = patched; # optional debug output
    };

  names = builtins.attrNames collect;
  merged = builtins.foldl' (acc: nm: acc // (applyPatchesFor nm collect.${nm})) {} names;
in merged
```

Properties:

- No per-repo JSON; patch discovery is filename-only
- Deterministic: stable sort; idempotent; minimal diffs over time
- Robust: if nixpkgs upgrades and the version changes, non-matching patches are ignored rather than breaking evaluation; build will fail only if a still-matching patch doesn’t apply

---

## CLI changes (`build-tools/tools/patch/patch-cpp.ts`)

Update filename generation and messaging; keep subcommands the same.

1. Normalize attr input to `pkgs.<name>`

```ts
function normalizeAttr(attr: string): string {
  const s = attr.trim().replace(/^pkgs\./i, "");
  return `pkgs.${s}`;
}
```

2. Compute encoded filename stem from attr

```ts
function encodeAttrForFilename(attrNorm: string): string {
  // pkgs.openssl -> pkgs/openssl -> pkgs__openssl
  const slash = attrNorm.replaceAll(".", "/");
  return slash.replaceAll("/", "__");
}
```

3. Write canonical patch file on apply

```ts
// after diff computed
await fs.mkdirp("patches/cpp");
const enc = encodeAttrForFilename(attrNorm);
const dst = path.join("patches", "cpp", `${enc}@${sess.version}.patch`);
// keep --force and idempotency semantics as today
```

4. Output

- Print the written patch path and a short note: “C++ overlay auto-discovers patches by filename; no snippet needed.”
- Drop the old overlay snippet.

5. Keep existing verification (dry-run `patch -p1` against origin) unchanged.

---

## Tests

Update and add tests under `build-tools/tools/tests/patching/`.

1. Create test: apply creates encoded patch and overlay picks it up

```ts
// build-tools/tools/tests/patching/patch-cpp.apply.encoded-name.test.ts
// - run patch-pkg start/apply cpp zlib
// - assert file exists: patches/cpp/pkgs__zlib@<ver>.patch
// - assert output mentions auto-discovery (no snippet)
// - nix eval: assert overlay derivation includes zlib override when version matches
```

2. Update existing create test

- Replace snippet assertion with auto-discovery assertion
- Replace expected filename to the encoded schema

3. Update real zlib verify test

- Remove manual writing of overlay file; rely on committed overlay
- Keep the small C program; ensure printed `ZLIB_VERSION` reflects the patched value

4. Multiple patches per attr

- Create two patches for the same attr/version; ensure overlay applies both in path-sorted order

5. Non-matching version

- Create a patch `@X.Y.Z` while current version is `A.B.C`; overlay should ignore it; build succeeds unmodified

---

## Implementation steps

1. Add overlay file

- Create `build-tools/tools/nix/overlays/cpp-patches.nix` as above

2. Update CLI

- Modify `build-tools/tools/patch/patch-cpp.ts`:
  - replace filename sanitize with `encodeAttrForFilename`
  - stop printing the overlay snippet; print auto-discovery note

3. Update tests

- Adjust current tests to the new filename and output behavior
- Add the new tests outlined above

4. Docs

- Update `docs/cpp/overlays.md` to describe the convention-only overlay and the filename schema
- Mention version filtering behavior and how to name files

5. CI/Dev shell

- No changes required; `flake.nix` already conditionally includes the overlay file

---

## Edge cases and behavior notes

- Missing attr on platform: overlay ignores entries whose `<name>` is absent in `prev`
- Absent `version` attribute: overlay applies all patches for that `<name>`
- Patch application failure: evaluation succeeds; failure occurs at build time when applying a matching patch; developers fix or remove patch file
- Determinism: filename-derived grouping and sorted application ensure stable inputs and minimal rebuild scope

---

## Acceptance criteria

- `patch-pkg apply cpp <attr>` writes `patches/cpp/<encoded>@<version>.patch` and is idempotent
- Overlay discovers patches automatically; no manual snippet required
- With a valid patch, a dependent C++ build links against the patched nixpkgs source and behavior changes accordingly (e.g., version string)
- Tests pass locally and in CI; adding/removing patch files causes only affected targets to rebuild
