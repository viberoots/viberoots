import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeIfChanged } from "./fs-helpers";

type MarketplacePlugin = {
  name?: unknown;
  source?: unknown;
  policy?: unknown;
  category?: unknown;
  [key: string]: unknown;
};

type Marketplace = {
  name?: unknown;
  interface?: { displayName?: unknown; [key: string]: unknown };
  plugins?: MarketplacePlugin[];
  [key: string]: unknown;
};

const repoSkillsPlugin: MarketplacePlugin = {
  name: "repo-skills",
  source: {
    source: "local",
    path: "./.viberoots/current/plugins/repo-skills",
  },
  policy: {
    installation: "INSTALLED_BY_DEFAULT",
    authentication: "ON_INSTALL",
  },
  category: "Productivity",
};

function defaultMarketplace(): Marketplace {
  return {
    name: "repo-plugins",
    interface: { displayName: "Repo Plugins" },
    plugins: [],
  };
}

function parseMarketplace(file: string, text: string): Marketplace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `error: ${file} is not valid JSON\nrepair: fix or remove the file, then rerun viberoots bootstrap`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `error: ${file} must contain a marketplace object\nrepair: fix or remove the file, then rerun viberoots bootstrap`,
    );
  }
  const marketplace = parsed as Marketplace;
  if (marketplace.plugins !== undefined && !Array.isArray(marketplace.plugins)) {
    throw new Error(
      `error: ${file} plugins must be an array\nrepair: fix or remove the file, then rerun viberoots bootstrap`,
    );
  }
  return marketplace;
}

function reconcileMarketplace(marketplace: Marketplace): Marketplace {
  if (typeof marketplace.name !== "string" || !marketplace.name) {
    marketplace.name = "repo-plugins";
  }
  if (!marketplace.interface || typeof marketplace.interface !== "object") {
    marketplace.interface = { displayName: "Repo Plugins" };
  } else if (
    typeof marketplace.interface.displayName !== "string" ||
    !marketplace.interface.displayName
  ) {
    marketplace.interface.displayName = "Repo Plugins";
  }
  const plugins = marketplace.plugins || [];
  const index = plugins.findIndex((plugin) => plugin?.name === "repo-skills");
  if (index === -1) plugins.push(repoSkillsPlugin);
  else plugins[index] = { ...plugins[index], ...repoSkillsPlugin };
  marketplace.plugins = plugins;
  return marketplace;
}

export async function writeRepoSkillsMarketplace(workspaceRoot: string): Promise<string> {
  const file = path.join(workspaceRoot, ".agents", "plugins", "marketplace.json");
  let marketplace = defaultMarketplace();
  try {
    marketplace = parseMarketplace(
      path.relative(workspaceRoot, file),
      await fsp.readFile(file, "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const reconciled = reconcileMarketplace(marketplace);
  await writeIfChanged(file, `${JSON.stringify(reconciled, null, 2)}\n`);
  return String(reconciled.name);
}
