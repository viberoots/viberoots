#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

process.env.TEST_RSYNC_ROOTS = process.env.TEST_RSYNC_ROOTS || "viberoots toolchains";

test(
  "Rust quality tools execute positive and negative paths under hostile PATH",
  { timeout: 600_000 },
  async () => {
    await runInTemp("rust-quality-tools", async (tmp, $) => {
      const toolchainResult = await $({ cwd: tmp, stdio: "pipe" })`
        nix build --accept-flake-config ${`path:${await workspaceFlakeRef(tmp)}#toolchains.rust`} --no-link --print-out-paths
      `;
      const tools = String(toolchainResult.stdout).trim().split("\n").filter(Boolean).at(-1) || "";
      assert.match(tools, /^\/nix\/store\//);
      const bin = (name: string) => path.join(tools, "bin", name);
      const crate = path.join(tmp, "quality-crate");
      await fs.mkdir(path.join(crate, "src"), { recursive: true });
      await fs.mkdir(path.join(crate, "benches"), { recursive: true });
      await fs.writeFile(
        path.join(crate, "Cargo.toml"),
        `[package]
name = "quality_crate"
version = "0.1.0"
edition = "2021"
[[bench]]
name = "smoke"
harness = false
`,
      );
      await fs.writeFile(
        path.join(crate, "Cargo.lock"),
        'version = 3\n\n[[package]]\nname = "quality_crate"\nversion = "0.1.0"\n',
      );
      const good = `/// Adds one.
///
/// \`\`\`
/// assert_eq!(quality_crate::add_one(1), 2);
/// \`\`\`
pub fn add_one(value: i32) -> i32 {
    value + 1
}

#[cfg(test)]
mod tests {
    #[test]
    fn adds_one() {
        assert_eq!(super::add_one(1), 2);
    }
}
`;
      await fs.writeFile(path.join(crate, "src/lib.rs"), good);
      await fs.writeFile(path.join(crate, "benches/smoke.rs"), "fn main() {}\n");
      const env = {
        ...process.env,
        PATH: `/hostile:${path.join(tools, "bin")}`,
        CARGO_HOME: path.join(tmp, "cargo-home"),
      };
      const run = (argv: string[]) =>
        $({ cwd: crate, env, stdio: "pipe", reject: false, nothrow: true })`${argv}`;

      for (const [tool, args] of [
        ["rust-analyzer", ["--version"]],
        ["rustfmt", ["--version"]],
        ["cargo-clippy", ["--version"]],
        ["rustdoc", ["--version"]],
        ["lldb", ["--version"]],
        ["ld.lld", ["--version"]],
      ] as const) {
        const result = await run([bin(tool), ...args]);
        assert.equal(result.exitCode, 0, `${tool} must execute from the Nix closure`);
      }
      assert.equal(
        (await run([bin("cargo"), "llvm-cov", "--version"])).exitCode,
        0,
        "cargo llvm-cov must execute from the Nix closure",
      );

      assert.equal((await run([bin("cargo"), "fmt", "--all", "--check"])).exitCode, 0);
      assert.equal(
        (
          await run([
            bin("cargo"),
            "clippy",
            "--offline",
            "--locked",
            "--all-targets",
            "--",
            "-D",
            "warnings",
          ])
        ).exitCode,
        0,
      );
      assert.equal(
        (await run([bin("cargo"), "test", "--offline", "--locked", "--doc"])).exitCode,
        0,
      );
      assert.equal(
        (await run([bin("cargo"), "test", "--offline", "--locked", "--benches", "--no-run"]))
          .exitCode,
        0,
      );
      const lcov = path.join(crate, "coverage.lcov");
      assert.equal(
        (
          await run([
            bin("cargo"),
            "llvm-cov",
            "--offline",
            "--locked",
            "--tests",
            "--lcov",
            "--output-path",
            lcov,
          ])
        ).exitCode,
        0,
      );
      assert.match(await fs.readFile(lcov, "utf8"), /SF:.*src\/lib\.rs/);

      await fs.writeFile(path.join(crate, "src/lib.rs"), "pub fn bad( )->i32{1}\n");
      assert.notEqual((await run([bin("cargo"), "fmt", "--all", "--check"])).exitCode, 0);
      await fs.writeFile(path.join(crate, "src/lib.rs"), "pub fn bad() { let unused = 1; }\n");
      assert.notEqual(
        (
          await run([
            bin("cargo"),
            "clippy",
            "--offline",
            "--locked",
            "--all-targets",
            "--",
            "-D",
            "warnings",
          ])
        ).exitCode,
        0,
      );
      await fs.writeFile(
        path.join(crate, "src/lib.rs"),
        `/// \`\`\`
/// assert_eq!(1, 2);
/// \`\`\`
pub fn documented() {}
`,
      );
      assert.notEqual(
        (await run([bin("cargo"), "test", "--offline", "--locked", "--doc"])).exitCode,
        0,
      );
      await fs.writeFile(path.join(crate, "src/lib.rs"), good);
      await fs.writeFile(path.join(crate, "benches/smoke.rs"), "fn main() { missing(); }\n");
      assert.notEqual(
        (await run([bin("cargo"), "test", "--offline", "--locked", "--benches", "--no-run"]))
          .exitCode,
        0,
      );
    });
  },
);
