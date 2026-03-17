import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function collectFiles(rootDir, currentDir = rootDir) {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, absPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(path.relative(rootDir, absPath));
  }
  return files;
}

function normalizeUrlPath(relativePath) {
  return `/${relativePath.split(path.sep).join("/")}`;
}

export function listPrecacheAssetUrls(clientDir) {
  return collectFiles(clientDir)
    .filter((relativePath) => {
      if (relativePath === "service-worker.js") {
        return false;
      }
      return /\.(?:js|css|wasm|webmanifest|svg|png)$/u.test(relativePath);
    })
    .map(normalizeUrlPath)
    .sort();
}

function createCacheVersion(precacheUrls) {
  const digest = createHash("sha256").update(precacheUrls.join("\n")).digest("hex");
  return `pleomino-${digest.slice(0, 12)}`;
}

export function injectServiceWorkerPrecacheManifest(serviceWorkerPath, precacheUrls) {
  const source = readFileSync(serviceWorkerPath, "utf8");
  const cacheVersion = createCacheVersion(precacheUrls);
  const next = source
    .replace('"__PLEOMINO_CACHE_VERSION__"', JSON.stringify(cacheVersion))
    .replace("__PLEOMINO_PRECACHED_ASSETS__", JSON.stringify(precacheUrls, null, 2));
  if (next === source) {
    throw new Error(`service worker placeholders were not found in ${serviceWorkerPath}`);
  }
  writeFileSync(serviceWorkerPath, next);
  return cacheVersion;
}

export function assertBuiltServiceWorkerReady(serviceWorkerPath) {
  const source = readFileSync(serviceWorkerPath, "utf8");
  if (source.includes("__PLEOMINO_CACHE_VERSION__")) {
    throw new Error(
      `service worker cache version placeholder was not replaced in ${serviceWorkerPath}`,
    );
  }
  if (source.includes("__PLEOMINO_PRECACHED_ASSETS__")) {
    throw new Error(`service worker precache placeholder was not replaced in ${serviceWorkerPath}`);
  }
}

export function readPrecacheAssetState(clientDir) {
  const urls = listPrecacheAssetUrls(clientDir);
  return {
    cacheVersion: createCacheVersion(urls),
    urls,
  };
}

export function ensureDistServiceWorkerPrecache(clientDir) {
  const serviceWorkerPath = path.join(clientDir, "service-worker.js");
  const stats = statSync(serviceWorkerPath);
  if (!stats.isFile()) {
    throw new Error(`missing built service worker at ${serviceWorkerPath}`);
  }
  const { urls, cacheVersion } = readPrecacheAssetState(clientDir);
  injectServiceWorkerPrecacheManifest(serviceWorkerPath, urls);
  assertBuiltServiceWorkerReady(serviceWorkerPath);
  return { urls, cacheVersion };
}
