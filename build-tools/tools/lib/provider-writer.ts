#!/usr/bin/env zx-wrapper
import path from "node:path";
import { renderTargetsFile, writeIfChanged, maybeAssumeUnchanged } from "./fs-helpers";
import { ensureAutoSection } from "./auto-section";
import { mkdirWithMacosMetadataExclusion } from "./macos-metadata";
import { providerNameForImporter } from "./providers";
import { providersHeaderFor, providersLoadFor } from "./providers-headers";
import { DEFAULT_PROVIDER_TARGETS_PATH, providerAutoTargetsPath } from "./workspace-state-paths";

export type ImporterProvider = {
  lockfile: string; // POSIX relative path, e.g. apps/web/pnpm-lock.yaml
  importer: string; // POSIX importer label, e.g. apps/web or "."
  patchPaths: string[]; // POSIX relative paths, deterministically sorted
};

export type ImporterWriterOptions = {
  outFile: string;
  ruleLoad: string; // e.g. 'load("//:defs_node.bzl", "node_importer_deps")'
  ruleName: string; // e.g. "node_importer_deps"
  /**
   * Optional full file header (banner + load lines). If provided, takes precedence
   * over ruleLoad-derived header. Must include desired trailing blank lines.
   */
  fileHeader?: string;
  autoSection?: {
    file?: string; // defaults to third_party/providers/TARGETS
    begin: string; // e.g. "# BEGIN AUTO_NODE"
    end: string; // e.g. "# END AUTO_NODE"
    header?: string; // usually same as ruleLoad
  };
};

function headerFrom(ruleLoad: string): string {
  return ["# GENERATED FILE — DO NOT EDIT.", ruleLoad, "", ""].join("\n");
}

function makeEntry(
  ruleName: string,
  name: string,
  lockfile: string,
  importer: string,
  patchPaths: string[],
): string {
  const pp = (patchPaths || [])
    .slice()
    .sort()
    .map((s) => `"${s}"`)
    .join(", ");
  return `${ruleName}(name="${name}", lockfile="${lockfile}", importer="${importer}", patch_paths=[${pp}])`;
}

function resolveInWorkspace(relOrAbs: string): string {
  if (!relOrAbs) return relOrAbs;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  const root = (process.env.BUCK_TEST_SRC || process.env.WORKSPACE_ROOT || process.cwd()).trim();
  return path.resolve(root, relOrAbs);
}

/**
 * Write importer-scoped provider TARGETS deterministically and synchronize an
 * auto-managed section in the curated providers/TARGETS file.
 *
 * Behavior:
 * - Provider names are derived via providerNameForImporter(lockfile, importer)
 * - Duplicate provider names for different keys throw (collision detection)
 * - Entries are sorted by provider name
 * - Header and auto-section formatting are stable
 */
export async function writeImporterProviders(
  providers: ImporterProvider[],
  opts: ImporterWriterOptions,
): Promise<void> {
  const nameKey = new Map<string, string>(); // provider name -> "lockfile#importer"
  const items: Array<{ name: string; entry: string }> = [];
  for (const p of providers) {
    const lockfile = String(p.lockfile || "").replace(/^\.\/+/, "");
    const importer = String(p.importer || "") || ".";
    const patchPaths = (p.patchPaths || []).slice().sort();
    const name = providerNameForImporter(lockfile, importer);
    const key = `${lockfile}#${importer}`;
    const prev = nameKey.get(name);
    if (prev && prev !== key) {
      throw new Error(`Provider name collision: ${name}\n${prev} vs ${key}`);
    }
    nameKey.set(name, key);
    items.push({ name, entry: makeEntry(opts.ruleName, name, lockfile, importer, patchPaths) });
  }
  // Sort deterministically by provider name
  items.sort((a, b) => a.name.localeCompare(b.name));
  const entries = items.map((it) => it.entry);

  const header =
    opts.fileHeader && opts.fileHeader.length > 0 ? opts.fileHeader : headerFrom(opts.ruleLoad);
  const outPath = resolveInWorkspace(opts.outFile);
  await mkdirWithMacosMetadataExclusion(path.dirname(outPath));
  await writeIfChanged(outPath, renderTargetsFile(header, entries));
  await maybeAssumeUnchanged(outPath);

  // Synchronize managed section in curated TARGETS
  if (opts.autoSection) {
    const file = resolveInWorkspace(opts.autoSection.file || DEFAULT_PROVIDER_TARGETS_PATH);
    await mkdirWithMacosMetadataExclusion(path.dirname(file));
    await ensureAutoSection({
      file,
      begin: opts.autoSection.begin,
      end: opts.autoSection.end,
      header: opts.autoSection.header || opts.ruleLoad,
      body: renderTargetsFile("", entries).trim(),
    });
    await maybeAssumeUnchanged(file);
  }
}

export default writeImporterProviders;

/**
 * Convenience wrapper to write importer providers by language with
 * standardized header, load(...) line, auto-section sentinels, and default out path.
 *
 * Supported:
 * - node   → rule: node_importer_deps,  sentinels: AUTO_NODE,
 *             out: .viberoots/workspace/providers/TARGETS.node.auto
 * - python → rule: python_importer_deps, sentinels: AUTO_PYTHON,
 *             out: .viberoots/workspace/providers/TARGETS.python.auto
 */
export async function writeImporterProvidersByLang(
  lang: string,
  providers: ImporterProvider[],
  opts?: Partial<ImporterWriterOptions> & { outFile?: string },
): Promise<void> {
  const id = String(lang || "")
    .trim()
    .toLowerCase();
  type RegistryEntry = {
    ruleName: string;
    begin: string;
    end: string;
    defaultOut: string;
  };
  const REGISTRY: Record<string, RegistryEntry> = {
    node: {
      ruleName: "node_importer_deps",
      begin: "# BEGIN AUTO_NODE",
      end: "# END AUTO_NODE",
      defaultOut: providerAutoTargetsPath("node"),
    },
    python: {
      ruleName: "python_importer_deps",
      begin: "# BEGIN AUTO_PYTHON",
      end: "# END AUTO_PYTHON",
      defaultOut: providerAutoTargetsPath("python"),
    },
  };
  const entry = REGISTRY[id];
  if (!entry) {
    throw new Error(`writeImporterProvidersByLang: unsupported language '${lang}'`);
  }

  const ruleLoad = providersLoadFor({ lang: id, rule: entry.ruleName });
  const fileHeader = providersHeaderFor({ lang: id, load: ruleLoad, rule: entry.ruleName });
  const outFile = (opts && opts.outFile) || entry.defaultOut;

  await writeImporterProviders(providers, {
    outFile,
    ruleLoad,
    ruleName: entry.ruleName,
    fileHeader,
    autoSection: {
      begin: entry.begin,
      end: entry.end,
      header: ruleLoad,
    },
  });
}
