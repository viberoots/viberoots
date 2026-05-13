#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resetInfisicalCredentialCacheForTests,
  resolveInfisicalAccessToken,
} from "../../deployments/deployment-secret-infisical-credentials";
import { startFakeInfisicalServer } from "./infisical.test-server";

test("Universal Auth cache keeps separate tokens per site URL and identity", async () => {
  const firstSite = await startFakeInfisicalServer([
    {
      clientId: "first-identity",
      clientSecret: "first-secret",
      accessToken: "first-token",
      expiresIn: 60,
    },
    {
      clientId: "second-identity",
      clientSecret: "second-secret",
      accessToken: "second-token",
      expiresIn: 60,
    },
  ]);
  const secondSite = await startFakeInfisicalServer({
    clientId: "first-identity",
    clientSecret: "first-secret",
    accessToken: "other-site-token",
    expiresIn: 60,
  });
  try {
    const first = { kind: "universal_auth" as const, siteUrl: firstSite.siteUrl };
    assert.equal(
      (
        await resolveInfisicalAccessToken({
          ...first,
          clientId: "first-identity",
          clientSecret: "first-secret",
        })
      ).accessToken,
      "first-token",
    );
    assert.equal(
      (
        await resolveInfisicalAccessToken({
          ...first,
          clientId: "second-identity",
          clientSecret: "second-secret",
        })
      ).accessToken,
      "second-token",
    );
    assert.equal(
      (
        await resolveInfisicalAccessToken({
          ...first,
          clientId: "first-identity",
          clientSecret: "first-secret",
        })
      ).accessToken,
      "first-token",
    );
    assert.equal(
      (
        await resolveInfisicalAccessToken({
          ...first,
          siteUrl: secondSite.siteUrl,
          clientId: "first-identity",
          clientSecret: "first-secret",
        })
      ).accessToken,
      "other-site-token",
    );
    assert.deepEqual(firstSite.calls, ["first-identity", "second-identity"]);
    assert.deepEqual(secondSite.calls, ["first-identity"]);
  } finally {
    resetInfisicalCredentialCacheForTests();
    await firstSite.close();
    await secondSite.close();
  }
});
