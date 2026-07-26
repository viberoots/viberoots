#!/usr/bin/env node
import process from "node:process";

import { readEffectiveNixCacheRoleProvenance } from "../lib/nix-cache-role-provenance.ts";

const nixBin = String(process.argv[2] || "").trim();
if (!nixBin) process.exit(64);
const roles = readEffectiveNixCacheRoleProvenance(nixBin);
if (!roles) process.exit(1);
process.stdout.write(
  `required\t${roles.required.join(" ")}\noptional\t${roles.optional.join(" ")}\n`,
);
