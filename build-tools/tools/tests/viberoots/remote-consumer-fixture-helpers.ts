import * as fsp from "node:fs/promises";
import path from "node:path";
import { artifactNixExperimentalFeatureArgs } from "../../lib/artifact-nix-policy";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";
import { timeDiagnosticAsync } from "../lib/test-helpers/timing";

export const REPO_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);
export const TEMPLATE_ROOT = new URL("../fixtures/viberoots/remote-consumer/", import.meta.url)
  .pathname;

async function writeFile(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

async function copyTree(src: string, dst: string, $: typeof globalThis.$): Promise<void> {
  await timeDiagnosticAsync("remote consumer fixture template copy", async () => {
    await fsp.mkdir(dst, { recursive: true });
    await $({ stdio: "pipe" })`rsync -a --chmod=Du+rwx,Dgo+rx,Fu+rw,Fgo+r ${src}/ ${dst}/`;
  });
}

export async function makeRemoteSource(root: string, $: typeof globalThis.$): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  const source = path.join(root, "remote-viberoots-src");
  const bareSource = path.join(root, "remote-viberoots.git");
  const emptyTemplate = path.join(root, "empty-git-template");
  await fsp.mkdir(emptyTemplate, { recursive: true });
  // Keep the loose-object graph quiescent until it is copied into the deterministic bare source.
  // Disabling only add-time GC is insufficient: commit may launch background maintenance.
  const gitEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "gc.auto",
    GIT_CONFIG_VALUE_0: "0",
    GIT_CONFIG_KEY_1: "maintenance.auto",
    GIT_CONFIG_VALUE_1: "0",
  };
  const seedPath = String(process.env.VBR_TEST_SEED_STORE_PATH || "").trim();
  const seedGitDir = seedPath ? path.join(seedPath, "viberoots", ".git") : "";
  const useSeedGit = seedGitDir
    ? await fsp
        .stat(seedGitDir)
        .then((s) => s.isDirectory())
        .catch(() => false)
    : false;
  let revision: string;
  if (useSeedGit) {
    revision = await timeDiagnosticAsync("remote source seed revision", async () =>
      String(
        (await $({ env: gitEnv, stdio: "pipe" })`git --git-dir=${seedGitDir} rev-parse HEAD`)
          .stdout || "",
      ).trim(),
    );
  } else {
    revision = await timeDiagnosticAsync("remote source fallback copy and commit", async () => {
      await $({
        stdio: "pipe",
      })`rsync -a --chmod=Du+rwx,Dgo+rx,Fu+rw,Fgo+r --exclude=.git --exclude=.direnv --exclude=.viberoots --exclude=buck-out --exclude=build-tools/tmp ${REPO_ROOT}/ ${source}/`;
      await fsp.chmod(source, 0o755);
      await $({ cwd: source, env: gitEnv })`git init -q --initial-branch=release/v1.4.2`;
      await $({ cwd: source, env: gitEnv })`git add .`;
      await $({
        cwd: source,
        env: gitEnv,
      })`git -c user.name=viberoots-fixture -c user.email=viberoots-fixture@example.invalid -c commit.gpgSign=false -c core.hooksPath=/dev/null commit -qm remote-source`;
      return String(
        (await $({ cwd: source, env: gitEnv, stdio: "pipe" })`git rev-parse HEAD`).stdout || "",
      ).trim();
    });
  }
  await timeDiagnosticAsync("remote source bare repository initialization", async () => {
    await $({
      env: gitEnv,
    })`git init -q --bare --initial-branch=release/v1.4.2 --template=${emptyTemplate} ${bareSource}`;
  });
  // Pack construction can choose different delta orderings for the same object graph.
  // A loose-object bare repo preserves the real Git boundary with stable Nix content.
  if (useSeedGit) {
    // The prepared seed is immutable and may already contain deterministic packfiles.
    await timeDiagnosticAsync("remote source seed object copy", async () => {
      await $({
        stdio: "pipe",
      })`rsync -a --chmod=Du+rwx,Fu+rw --exclude=info ${seedGitDir}/objects/ ${bareSource}/objects/`;
    });
    const seedIndex = path.join(root, "seed-source.index");
    const preludeTargetFile = path.join(root, "seed-prelude-link-target");
    const seedGitEnv = { ...gitEnv, GIT_INDEX_FILE: seedIndex };
    await fsp.writeFile(preludeTargetFile, await fsp.readlink(path.join(REPO_ROOT, "prelude")));
    const preludeBlob = String(
      (
        await $({
          env: seedGitEnv,
          stdio: "pipe",
        })`git --git-dir=${bareSource} hash-object -w ${preludeTargetFile}`
      ).stdout || "",
    ).trim();
    const metadataBlob = String(
      (
        await $({
          env: seedGitEnv,
          stdio: "pipe",
        })`git --git-dir=${bareSource} hash-object -w ${path.join(REPO_ROOT, ".metadata_never_index")}`
      ).stdout || "",
    ).trim();
    await $({ env: seedGitEnv })`git --git-dir=${bareSource} read-tree ${revision}`;
    await $({
      env: seedGitEnv,
    })`git --git-dir=${bareSource} update-index --add --cacheinfo 120000 ${preludeBlob} prelude`;
    await $({
      env: seedGitEnv,
    })`git --git-dir=${bareSource} update-index --add --cacheinfo 100644 ${metadataBlob} .metadata_never_index`;
    const tree = String(
      (await $({ env: seedGitEnv, stdio: "pipe" })`git --git-dir=${bareSource} write-tree`)
        .stdout || "",
    ).trim();
    revision = String(
      (
        await $({
          env: seedGitEnv,
          input: "remote-source\n",
          stdio: "pipe",
        })`git -c user.name=viberoots-fixture -c user.email=viberoots-fixture@example.invalid --git-dir=${bareSource} commit-tree ${tree}`
      ).stdout || "",
    ).trim();
  } else {
    await timeDiagnosticAsync("remote source fallback object copy", async () => {
      await $({
        stdio: "pipe",
      })`rsync -a --exclude=info --exclude=pack ${source}/.git/objects/ ${bareSource}/objects/`;
    });
  }
  await $({
    env: gitEnv,
    stdio: "pipe",
  })`git --git-dir=${bareSource} update-ref refs/heads/release/v1.4.2 ${revision}`;

  const nixBin = ensureNixStoreToolPathSync("nix");
  const nixFeatures = artifactNixExperimentalFeatureArgs();
  const added = await timeDiagnosticAsync(
    "remote source Nix store materialization",
    async () =>
      await $({
        stdio: "pipe",
      })`${nixBin} ${nixFeatures} store add-path --name viberoots-remote-git ${bareSource}`,
  );
  const storePath = String(added.stdout || "").trim();
  if (!/^\/nix\/store\/[a-z0-9]{32}-viberoots-remote-git$/.test(storePath)) {
    throw new Error(`expected literal immutable remote Git source, got: ${storePath || "<empty>"}`);
  }
  const stat = await fsp.lstat(storePath);
  if (stat.isSymbolicLink() || (await fsp.realpath(storePath)) !== storePath) {
    throw new Error(`remote Git source must be a literal Nix store path: ${storePath}`);
  }
  return storePath;
}

async function writeConsumerOwnedState(consumer: string, name: string): Promise<void> {
  await writeFile(
    path.join(consumer, "projects", "config", "node-modules.hashes.json"),
    JSON.stringify({ consumer: name, owner: "workspace" }, null, 2) + "\n",
  );
  await writeFile(
    path.join(consumer, "projects", "docs", `${name}.md`),
    `# ${name}\n\nProject-owned documentation fixture.\n`,
  );
}

export async function makeConsumerWithFlakeUrl(
  root: string,
  name: string,
  flakeUrl: string,
  $: typeof globalThis.$,
): Promise<string> {
  const consumer = path.join(root, name);
  await copyTree(TEMPLATE_ROOT, consumer, $);
  await timeDiagnosticAsync("remote consumer fixture metadata preparation", async () => {
    await writeFile(
      path.join(consumer, ".viberoots", "workspace", "flake.nix"),
      `{
  inputs.viberoots.url = "${flakeUrl}";
  outputs = inputs: inputs.viberoots.lib.mkWorkspace {
    workspaceSrc = ../..;
    viberootsInput = inputs.viberoots;
    workspaceName = "${name}";
  };
}
`,
    );
    await writeConsumerOwnedState(consumer, name);
    await fsp.rm(path.join(consumer, ".viberoots", "workspace", "flake.lock"), { force: true });
  });
  await timeDiagnosticAsync("remote consumer Nix flake lock", async () => {
    await $({
      cwd: path.join(consumer, ".viberoots", "workspace"),
      stdio: "pipe",
    })`nix flake lock --accept-flake-config`.quiet();
  });
  await timeDiagnosticAsync("remote consumer Git initialization", async () => {
    await $({ cwd: consumer, stdio: "pipe" })`git init -q`;
    await $({ cwd: consumer, stdio: "pipe" })`git add -A`;
    await $({ cwd: consumer, stdio: "pipe" })`git commit -qm consumer-fixture`;
  });
  return consumer;
}

export async function makeConsumer(
  root: string,
  name: string,
  source: string,
  $: typeof globalThis.$,
): Promise<string> {
  return await makeConsumerWithFlakeUrl(root, name, `git+file://${source}?ref=release/v1.4.2`, $);
}
