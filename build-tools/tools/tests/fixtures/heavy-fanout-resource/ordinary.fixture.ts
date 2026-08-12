#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { recordFixtureInterval } from "./fixture-interval";

test("ordinary", async () => await recordFixtureInterval("ordinary", 3_000));
