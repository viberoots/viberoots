import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_BOOTSTRAP_ARGS,
  withBootstrapCredentialScope,
  withBootstrapKeychainServiceName,
} from "./infisical-iac-bootstrap-config";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { macosKeychainCommand } from "./sprinkleref-keychain";

const LOCAL_PATH_CANDIDATES = [
  { path: "sprinkleref", description: "legacy local SprinkleRef resolver state directory" },
  {
    path: ".local/infisical-bootstrap-credentials.json",
    description: "local-file bootstrap credential store for this checkout",
  },
];

export type LocalResetItem = { path: string; description: string };
export type KeychainResetItem = { account: string; description: string };
export type LocalBootstrapResetPlan = {
  localItems: LocalResetItem[];
  keychainService: string;
  keychainItems: KeychainResetItem[];
};
export type ResetIo = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  question?: (prompt: string) => Promise<string>;
  platform?: NodeJS.Platform;
  cwd?: string;
  removePath?: (absolutePath: string) => Promise<void>;
  keychainRunner?: (command: string, args: string[]) => { status: number };
};

export async function discoverLocalResetPlan(
  io: ResetIo,
  root: string,
): Promise<LocalBootstrapResetPlan> {
  const keychainService = await resolveBootstrapKeychainService(root);
  return {
    localItems: await discoverLocalItems(root),
    keychainService,
    keychainItems: await discoverKeychainItems(io, root, keychainService),
  };
}

export async function applyLocalResetPlan(
  io: ResetIo,
  stderr: (text: string) => void,
  root: string,
  plan: LocalBootstrapResetPlan,
) {
  const removePath =
    io.removePath || ((target: string) => fs.rm(target, { recursive: true, force: true }));
  for (const item of plan.localItems) {
    const target = path.resolve(root, item.path);
    if (!target.startsWith(`${root}${path.sep}`))
      throw new Error(`refusing to remove ${item.path}`);
    await removePath(target);
  }
  removeKeychainEntries(io, stderr, plan.keychainItems, plan.keychainService);
}

async function discoverKeychainItems(
  io: ResetIo,
  root: string,
  keychainService: string,
): Promise<KeychainResetItem[]> {
  if ((io.platform || process.platform) !== "darwin") return [];
  const scopedArgs = await withBootstrapCredentialScope(DEFAULT_BOOTSTRAP_ARGS, root);
  const refs = repoBootstrapCredentialRefs(
    { name: scopedArgs.identityName },
    scopedArgs.bootstrapCredentialScope,
  );
  const candidates = [
    {
      account: refs.clientIdRef,
      description: "Infisical Universal Auth client id for this checkout's repo bootstrap identity",
    },
    {
      account: refs.clientSecretRef,
      description:
        "Infisical Universal Auth client secret for this machine; Infisical cannot show this secret again after creation",
    },
  ];
  const runner = io.keychainRunner || defaultRunner;
  return candidates.filter(
    (item) =>
      runner("security", macosKeychainCommand("read", keychainService, item.account)).status === 0,
  );
}

async function resolveBootstrapKeychainService(root: string) {
  const scopedArgs = await withBootstrapKeychainServiceName(DEFAULT_BOOTSTRAP_ARGS, root);
  return scopedArgs.bootstrapKeychainServiceName || "";
}

async function discoverLocalItems(root: string): Promise<LocalResetItem[]> {
  const discovered: LocalResetItem[] = [];
  for (const item of LOCAL_PATH_CANDIDATES) {
    if (await pathExists(path.join(root, item.path))) discovered.push(item);
  }
  const deploymentsRoot = path.join(root, "projects", "deployments");
  for (const family of (await fs.readdir(deploymentsRoot).catch(() => [])).sort()) {
    const tofuDir = path.join("projects", "deployments", family, "infisical", "opentofu");
    const entries = new Set(await fs.readdir(path.join(root, tofuDir)).catch(() => []));
    for (const rel of [
      ".terraform",
      ".terraform.lock.hcl",
      "terraform.tfstate",
      "terraform.tfstate.backup",
    ]) {
      if (entries.has(rel)) {
        discovered.push({
          path: path.join(tofuDir, rel),
          description: tofuDescription(family, rel),
        });
      }
    }
  }
  const seen = new Set<string>();
  return discovered.filter((item) => !seen.has(item.path) && Boolean(seen.add(item.path)));
}

function removeKeychainEntries(
  io: ResetIo,
  stderr: (text: string) => void,
  items: KeychainResetItem[],
  service: string,
) {
  if ((io.platform || process.platform) !== "darwin") {
    stderr("Skipping macOS Keychain cleanup because this host is not macOS.");
    return;
  }
  const runner = io.keychainRunner || defaultRunner;
  for (const item of items)
    runner("security", macosKeychainCommand("remove", service, item.account));
}

async function pathExists(target: string) {
  return fs.lstat(target).then(
    () => true,
    () => false,
  );
}

function tofuDescription(family: string, rel: string) {
  if (rel === ".terraform") return `OpenTofu working directory for ${family} deployment bootstrap`;
  if (rel === ".terraform.lock.hcl")
    return `OpenTofu provider lock file for ${family} deployment bootstrap`;
  if (rel === "terraform.tfstate") return `local OpenTofu state for ${family} deployment bootstrap`;
  return `backup of local OpenTofu state for ${family} deployment bootstrap`;
}

function defaultRunner(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  return { status: result.status ?? 1 };
}
