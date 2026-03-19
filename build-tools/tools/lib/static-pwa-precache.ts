#!/usr/bin/env zx-wrapper
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const STATIC_PWA_CACHE_VERSION_PLACEHOLDER = "__STATIC_PWA_CACHE_VERSION__";
export const STATIC_PWA_PRECACHED_ASSETS_PLACEHOLDER = "__STATIC_PWA_PRECACHED_ASSETS__";

const DEFAULT_PRECACHED_EXTENSIONS = [
  ".avif",
  ".css",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".png",
  ".svg",
  ".wasm",
  ".webmanifest",
  ".webp",
] as const;

export type StaticPwaPrecacheOptions = {
  cacheVersionPlaceholder?: string;
  cacheVersionPrefix?: string;
  extraUrls?: readonly string[];
  precacheExtensions?: readonly string[];
  precacheUrlsPlaceholder?: string;
  serviceWorkerPath?: string;
};

export type StaticPwaPrecacheState = {
  cacheVersion: string;
  urls: string[];
};

function collectFiles(rootDir: string, currentDir: string = rootDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];
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

function normalizeUrlPath(relativePath: string): string {
  return `/${relativePath.split(path.sep).join("/")}`;
}

function normalizeUrlList(urls: readonly string[]): string[] {
  return [
    ...new Set(urls.map((url) => readOptionString(url, "")).filter((url) => url !== "")),
  ].sort();
}

function normalizeExtensions(extensions: readonly string[]): string[] {
  return [...new Set(extensions.map((extension) => extension.toLowerCase()))].sort();
}

function isPrecachableAsset(relativePath: string, extensions: readonly string[]): boolean {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (normalizedPath.startsWith("server/")) {
    return false;
  }
  if (relativePath === "service-worker.js") {
    return false;
  }
  return extensions.some((extension) => relativePath.toLowerCase().endsWith(extension));
}

function readOptionString(value: string | undefined, fallback: string): string {
  const next = String(value || "").trim();
  return next === "" ? fallback : next;
}

export function listStaticPwaPrecacheAssetUrls(
  clientDir: string,
  options: StaticPwaPrecacheOptions = {},
): string[] {
  const extensions = normalizeExtensions(
    options.precacheExtensions || DEFAULT_PRECACHED_EXTENSIONS,
  );
  return normalizeUrlList([
    ...collectFiles(clientDir)
      .filter((relativePath) => isPrecachableAsset(relativePath, extensions))
      .map(normalizeUrlPath),
    ...(options.extraUrls || []),
  ]);
}

export function createStaticPwaCacheVersion(
  precacheUrls: readonly string[],
  cacheVersionPrefix: string = "static-pwa",
): string {
  const prefix = readOptionString(cacheVersionPrefix, "static-pwa");
  const digest = createHash("sha256").update(precacheUrls.join("\n")).digest("hex");
  return `${prefix}-${digest.slice(0, 12)}`;
}

export function injectStaticPwaServiceWorkerManifest(
  serviceWorkerPath: string,
  precacheUrls: readonly string[],
  options: StaticPwaPrecacheOptions = {},
): string {
  const cacheVersionPlaceholder = readOptionString(
    options.cacheVersionPlaceholder,
    STATIC_PWA_CACHE_VERSION_PLACEHOLDER,
  );
  const precacheUrlsPlaceholder = readOptionString(
    options.precacheUrlsPlaceholder,
    STATIC_PWA_PRECACHED_ASSETS_PLACEHOLDER,
  );
  const source = readFileSync(serviceWorkerPath, "utf8");
  if (!source.includes(cacheVersionPlaceholder) || !source.includes(precacheUrlsPlaceholder)) {
    throw new Error(`service worker placeholders were not found in ${serviceWorkerPath}`);
  }
  const cacheVersion = createStaticPwaCacheVersion(precacheUrls, options.cacheVersionPrefix);
  const next = source
    .replaceAll(cacheVersionPlaceholder, cacheVersion)
    .replaceAll(precacheUrlsPlaceholder, JSON.stringify(precacheUrls, null, 2));
  writeFileSync(serviceWorkerPath, next);
  return cacheVersion;
}

export function assertStaticPwaServiceWorkerReady(
  serviceWorkerPath: string,
  options: StaticPwaPrecacheOptions = {},
): void {
  const cacheVersionPlaceholder = readOptionString(
    options.cacheVersionPlaceholder,
    STATIC_PWA_CACHE_VERSION_PLACEHOLDER,
  );
  const precacheUrlsPlaceholder = readOptionString(
    options.precacheUrlsPlaceholder,
    STATIC_PWA_PRECACHED_ASSETS_PLACEHOLDER,
  );
  const source = readFileSync(serviceWorkerPath, "utf8");
  if (source.includes(cacheVersionPlaceholder)) {
    throw new Error(
      `service worker cache version placeholder was not replaced in ${serviceWorkerPath}`,
    );
  }
  if (source.includes(precacheUrlsPlaceholder)) {
    throw new Error(`service worker precache placeholder was not replaced in ${serviceWorkerPath}`);
  }
}

export function readStaticPwaPrecacheState(
  clientDir: string,
  options: StaticPwaPrecacheOptions = {},
): StaticPwaPrecacheState {
  const urls = listStaticPwaPrecacheAssetUrls(clientDir, options);
  return {
    cacheVersion: createStaticPwaCacheVersion(urls, options.cacheVersionPrefix),
    urls,
  };
}

export function ensureDistStaticPwaPrecache(
  clientDir: string,
  options: StaticPwaPrecacheOptions = {},
): StaticPwaPrecacheState {
  const serviceWorkerPath = readOptionString(
    options.serviceWorkerPath,
    path.join(clientDir, "service-worker.js"),
  );
  const stats = statSync(serviceWorkerPath);
  if (!stats.isFile()) {
    throw new Error(`missing built service worker at ${serviceWorkerPath}`);
  }
  const state = readStaticPwaPrecacheState(clientDir, options);
  injectStaticPwaServiceWorkerManifest(serviceWorkerPath, state.urls, options);
  assertStaticPwaServiceWorkerReady(serviceWorkerPath, options);
  return state;
}
