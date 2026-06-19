import * as fsp from "node:fs/promises";
import path from "node:path";

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
  const source = path.join(root, "remote-viberoots-src");
  await $({
    stdio: "pipe",
  })`rsync -a --exclude=.git --exclude=.direnv --exclude=.viberoots --exclude=buck-out --exclude=build-tools/tmp ${REPO_ROOT}/ ${source}/`;
  await $({ cwd: source })`git init -q`;
  await $({ cwd: source })`git add .`;
  await $({ cwd: source })`git commit -qm remote-source`;
  await $({ cwd: source })`git branch release/v1.4.2`;
  return source;
}

async function writeConsumerOwnedState(consumer: string, name: string): Promise<void> {
  await writeFile(
    path.join(consumer, "projects", "node-modules.hashes.json"),
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
  })`nix flake lock --accept-flake-config`;
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
