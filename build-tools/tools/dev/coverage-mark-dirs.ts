#!/usr/bin/env zx-wrapper
import path from "node:path";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";

await mkdirWithMacosMetadataExclusion(path.join(process.cwd(), "coverage"));
await mkdirWithMacosMetadataExclusion(path.join(process.cwd(), "coverage", "raw"));
