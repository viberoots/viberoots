#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { recordFixtureInterval } from "./fixture-interval";

test("heavy one", async () => await recordFixtureInterval("heavy-one", 2_000, true));
