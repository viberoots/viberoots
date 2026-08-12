import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import rustPatchHandler from "../patch/patch-rust";
import { listSessions } from "../patch/state";
import { rustPatchFilename } from "../patch/rust-sync-required";
import { dependencyKey, PROTECTED_DEPENDENCY } from "./protected-rust-patch-consumer";
import type { ProtectedRustPatchCaseDefinition } from "./protected-rust-patch-case-definitions";

export type ProtectedPatchWorkflow = {
  apply(): Promise<{ patchPath: string; patchDigest: string }>;
  remove(): Promise<void>;
};

export function protectedPatchWorkflow(opts: {
  workspaceRoot: string;
  definition: ProtectedRustPatchCaseDefinition;
}): ProtectedPatchWorkflow {
  if (String(process.env.NIX_RUST_TEST_RESOLVE_JSON || "").trim()) {
    throw new Error("protected Rust CI forbids test fixed-source authority");
  }
  const importer = opts.definition.cargoRoot;
  const args = [
    PROTECTED_DEPENDENCY.name,
    "--importer",
    importer,
    "--version",
    PROTECTED_DEPENDENCY.version,
    "--source",
    PROTECTED_DEPENDENCY.source,
  ];
  const patchPath = path.join(
    opts.workspaceRoot,
    importer,
    "patches/rust",
    rustPatchFilename(
      PROTECTED_DEPENDENCY.name,
      PROTECTED_DEPENDENCY.version,
      PROTECTED_DEPENDENCY.source,
    ),
  );
  const withWorkflowEnv = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousCwd = process.cwd();
    const previous = new Map<string, string | undefined>();
    const values = {
      WORKSPACE_ROOT: opts.workspaceRoot,
      PATCH_RUST_ECHO_SNIPPET: "1",
      NIX_RUST_DEV_OVERRIDE_JSON: "{}",
    };
    try {
      process.chdir(opts.workspaceRoot);
      for (const [name, value] of Object.entries(values)) {
        previous.set(name, process.env[name]);
        process.env[name] = value;
      }
      return await operation();
    } finally {
      process.chdir(previousCwd);
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };
  return {
    apply: async () =>
      await withWorkflowEnv(async () => {
        await rustPatchHandler.start(args);
        const sessions = await listSessions("rust");
        const session = sessions.find(({ moduleKey }) => moduleKey === dependencyKey(""));
        if (!session) throw new Error("protected Rust patch workflow did not create a session");
        const source = path.join(session.rec.workspacePath, "src/lib.rs");
        const before = await fs.readFile(source, "utf8");
        if (before !== "pub fn observed() -> i32 { 42 }\n") {
          throw new Error("protected Rust dependency source has an unexpected baseline");
        }
        await fs.writeFile(source, "pub fn observed() -> i32 { 43 }\n");
        await rustPatchHandler.apply(args);
        const patch = await fs.readFile(patchPath);
        return {
          patchPath: path.relative(opts.workspaceRoot, patchPath).split(path.sep).join("/"),
          patchDigest: digest(patch),
        };
      }),
    remove: async () =>
      await withWorkflowEnv(async () => {
        await rustPatchHandler.remove(args);
        await fs.access(patchPath).then(
          () => {
            throw new Error("protected Rust patch workflow left its patch file");
          },
          () => undefined,
        );
      }),
  };
}

function digest(value: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
