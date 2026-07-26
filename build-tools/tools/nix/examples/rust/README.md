# Rust examples

This directory retains the source-owned native example used by planner and registry tests. Public
project generation uses `build-tools/tools/scaffolding/templates/rust/cli`. Rust scaffolding remains
experimental until the later parity and hermeticity checkpoints pass.

Create the reviewed CLI shape with:

```sh
scaf new rust cli demo --yes
u
i --without-secrets
b //projects/apps/demo:demo
v //projects/apps/demo:demo-test
p //projects/apps/demo:demo
```

The scaffold includes checked-in `Cargo.toml`/`Cargo.lock`, a native executable and test, a
freestanding WASM target, and `patches/rust/`. `p` is the documented runnable command. WASI targets
use the repository-owned runner installed by the Nix derivation; projects do not author Node/WASI
loaders.
