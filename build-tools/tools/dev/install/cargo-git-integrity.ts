import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type Run = (command: string, args: string[], cwd: string) => Promise<string>;

async function assertCargoIdentity(
  manifest: string,
  cwd: string,
  expectedName: string,
  expectedVersion: string,
  key: string,
  run: Run,
): Promise<void> {
  const canonicalManifest = await fsp.realpath(manifest);
  const metadata = JSON.parse(
    await run(
      "cargo",
      [
        "metadata",
        "--offline",
        "--format-version",
        "1",
        "--no-deps",
        "--manifest-path",
        canonicalManifest,
      ],
      cwd,
    ),
  ) as {
    packages?: Array<{ manifest_path?: unknown; name?: unknown; version?: unknown }>;
  };
  const matches = await Promise.all(
    (metadata.packages || []).map(async (pkg) => ({
      pkg,
      manifest:
        typeof pkg.manifest_path === "string"
          ? await fsp.realpath(pkg.manifest_path).catch(() => "")
          : "",
    })),
  ).then((packages) => packages.filter((pkg) => pkg.manifest === canonicalManifest));
  if (matches.length !== 1) {
    throw new Error(`Cargo Git package subtree has ambiguous canonical metadata: ${key}`);
  }
  const identity = matches[0]!.pkg;
  if (
    typeof identity.name !== "string" ||
    typeof identity.version !== "string" ||
    identity.name.toLowerCase() !== expectedName.toLowerCase() ||
    identity.version !== expectedVersion
  ) {
    throw new Error(`Cargo Git package subtree does not match locked name/version: ${key}`);
  }
}

export async function verifiedGitSourceCopy(
  originPath: string,
  key: string,
  source: string,
  run: Run,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const revision = source.match(/#([a-fA-F0-9]{40,64})$/)?.[1]?.toLowerCase() || "";
  if (!source.startsWith("git+") || !revision || !key.endsWith(`#${source}`)) {
    throw new Error(`Cargo Git materialization identity is not a full locked revision: ${key}`);
  }
  const split = key.slice(0, -source.length - 1).lastIndexOf("@");
  const expectedName = key.slice(0, split);
  const expectedVersion = key.slice(split + 1, -source.length - 1);
  if (split < 1 || !expectedVersion) {
    throw new Error(`Cargo Git materialization package identity is invalid: ${key}`);
  }
  const canonicalOrigin = await fsp.realpath(originPath);
  const head = (await run("git", ["rev-parse", "HEAD"], canonicalOrigin)).trim().toLowerCase();
  if (head !== revision) {
    throw new Error(`Cargo Git cache revision does not match Cargo.lock: ${key}`);
  }
  const repository = await fsp.realpath(
    (await run("git", ["rev-parse", "--show-toplevel"], canonicalOrigin)).trim(),
  );
  const relative = path.relative(repository, canonicalOrigin);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Cargo Git package subtree is outside its locked repository: ${key}`);
  }
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-git-verified-"));
  const checkout = path.join(temporary, "checkout");
  const packageRoot = path.join(checkout, relative);
  const root = path.join(temporary, "normalized");
  try {
    await run(
      "git",
      ["clone", "--local", "--no-hardlinks", "--no-checkout", repository, checkout],
      repository,
    );
    await run("git", ["checkout", "--detach", revision], checkout);
    const manifest = path.join(packageRoot, "Cargo.toml");
    await assertCargoIdentity(manifest, checkout, expectedName, expectedVersion, key, run);
    const packageTarget = path.join(temporary, "target");
    await run(
      "cargo",
      [
        "package",
        "--offline",
        "--allow-dirty",
        "--no-verify",
        "--manifest-path",
        manifest,
        "--target-dir",
        packageTarget,
      ],
      checkout,
    );
    const archives = (await fsp.readdir(path.join(packageTarget, "package")))
      .filter((name) => name.endsWith(".crate"))
      .sort();
    if (archives.length !== 1) {
      throw new Error(`Cargo Git package normalization produced ambiguous archives: ${key}`);
    }
    await fsp.mkdir(root);
    await run(
      "tar",
      [
        "-xzf",
        path.join(packageTarget, "package", archives[0]!),
        "-C",
        root,
        "--strip-components=1",
      ],
      temporary,
    );
    await assertCargoIdentity(
      path.join(root, "Cargo.toml"),
      root,
      expectedName,
      expectedVersion,
      key,
      run,
    );
    await fsp.rm(checkout, { recursive: true, force: true });
    await fsp.rm(packageTarget, { recursive: true, force: true });
    return {
      root,
      cleanup: () => fsp.rm(temporary, { recursive: true, force: true }),
    };
  } catch (error) {
    await fsp.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
