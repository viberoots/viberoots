#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagList, getFlagStr } from "../lib/cli.ts";
import {
  ensureDistStaticPwaPrecache,
  STATIC_PWA_CACHE_VERSION_PLACEHOLDER,
  STATIC_PWA_PRECACHED_ASSETS_PLACEHOLDER,
} from "../lib/static-pwa-precache.ts";

const clientDir = getFlagStr("client-dir").trim();
if (clientDir === "") {
  throw new Error("materialize-static-pwa-precache.ts requires --client-dir");
}

const serviceWorkerPath = getFlagStr("service-worker").trim();
const cacheVersionPrefix = getFlagStr("cache-version-prefix").trim();
const cacheVersionPlaceholder = getFlagStr(
  "cache-version-placeholder",
  STATIC_PWA_CACHE_VERSION_PLACEHOLDER,
).trim();
const extraUrls = getFlagList("extra-urls");
const precacheUrlsPlaceholder = getFlagStr(
  "precache-urls-placeholder",
  STATIC_PWA_PRECACHED_ASSETS_PLACEHOLDER,
).trim();

const state = ensureDistStaticPwaPrecache(path.resolve(clientDir), {
  cacheVersionPlaceholder,
  cacheVersionPrefix,
  extraUrls,
  precacheUrlsPlaceholder,
  serviceWorkerPath: serviceWorkerPath === "" ? undefined : path.resolve(serviceWorkerPath),
});

process.stdout.write(`${JSON.stringify(state)}\n`);
