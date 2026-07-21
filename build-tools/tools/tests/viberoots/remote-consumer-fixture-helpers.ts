import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

export const REPO_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);
export const TEMPLATE_ROOT = new URL("../fixtures/viberoots/remote-consumer/", import.meta.url)
  .pathname;

async function writeFile(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

async function copyTree(src: string, dst: string, $: typeof globalThis.$): Promise<void> {
  await fsp.mkdir(dst, { recursive: true });
  await $({ stdio: "pipe" })`rsync -a --chmod=Du+rwx,Dgo+rx,Fu+rw,Fgo+r ${src}/ ${dst}/`;
}

export async function makeRemoteSource(root: string, $: typeof globalThis.$): Promise<string> {
  await fsp.mkdir(root, { recursive: true });
  const source = path.join(root, "remote-viberoots-src");
  const bareSource = path.join(root, "remote-viberoots.git");
  const emptyTemplate = path.join(root, "empty-git-template");
  await fsp.mkdir(emptyTemplate, { recursive: true });
  const gitEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  await $({
    stdio: "pipe",
  })`rsync -a --chmod=Du+rwx,Dgo+rx,Fu+rw,Fgo+r --exclude=.git --exclude=.direnv --exclude=.viberoots --exclude=buck-out --exclude=build-tools/tmp ${REPO_ROOT}/ ${source}/`;
  await fsp.chmod(source, 0o755);
  await $({ cwd: source, env: gitEnv })`git init -q --initial-branch=release/v1.4.2`;
  await $({ cwd: source, env: gitEnv })`git -c gc.auto=0 add .`;
  await $({
    cwd: source,
    env: gitEnv,
  })`git -c user.name=viberoots-fixture -c user.email=viberoots-fixture@example.invalid -c commit.gpgSign=false -c core.hooksPath=/dev/null commit -qm remote-source`;
  const revision = String(
    (await $({ cwd: source, env: gitEnv, stdio: "pipe" })`git rev-parse HEAD`).stdout || "",
  ).trim();
  await $({
    env: gitEnv,
  })`git init -q --bare --initial-branch=release/v1.4.2 --template=${emptyTemplate} ${bareSource}`;
  // Pack construction can choose different delta orderings for the same object graph.
  // A loose-object bare repo preserves the real Git boundary with stable Nix content.
  await $({
    stdio: "pipe",
  })`rsync -a --exclude=info --exclude=pack ${source}/.git/objects/ ${bareSource}/objects/`;
  await $({
    env: gitEnv,
    stdio: "pipe",
  })`git --git-dir=${bareSource} update-ref refs/heads/release/v1.4.2 ${revision}`;

  const nixBin = ensureNixStoreToolPathSync("nix");
  const added = await $({
    stdio: "pipe",
  })`${nixBin} store add-path --name viberoots-remote-git ${bareSource}`;
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
  await $({
    cwd: path.join(consumer, ".viberoots", "workspace"),
    stdio: "pipe",
  })`nix flake lock --accept-flake-config`.quiet();
  await $({ cwd: consumer, stdio: "pipe" })`git init -q`;
  await $({ cwd: consumer, stdio: "pipe" })`git add -A`;
  await $({ cwd: consumer, stdio: "pipe" })`git commit -qm consumer-fixture`;
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
