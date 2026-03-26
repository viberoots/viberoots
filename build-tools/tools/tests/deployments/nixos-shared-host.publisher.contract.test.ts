#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { renderNixosSharedHostConfig } from "../../deployments/nixos-shared-host.ts";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform.ts";
import {
  materializeNixosSharedHostRuntime,
  nixosSharedHostContainerRoot,
} from "../../deployments/nixos-shared-host-runtime.ts";
import { publishNixosSharedHostStaticWebapp } from "../../deployments/nixos-shared-host-static-publisher.ts";
import { runInTemp } from "../lib/test-helpers";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string, marker: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${marker}</html>\n`, "utf8");
}

test("nixos-shared-host publisher stages immutable releases and atomically activates current/live", async () => {
  await runInTemp("nixos-shared-host-publisher", async (tmp) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const rendered = renderNixosSharedHostConfig(createNixosSharedHostPlatformState([deployment]));
    const hostRoot = path.join(tmp, "host");
    const artifactV1 = path.join(tmp, "artifact-v1");
    const artifactV2 = path.join(tmp, "artifact-v2");
    await materializeNixosSharedHostRuntime(hostRoot, rendered);
    await writeArtifact(artifactV1, "v1");
    await writeArtifact(artifactV2, "v2");
    const container = rendered.containers[deployment.providerTarget.containerName];
    const containerRoot = nixosSharedHostContainerRoot(hostRoot, container.containerName);
    const first = await publishNixosSharedHostStaticWebapp({
      artifactDir: artifactV1,
      containerRoot,
      layout: container,
    });
    const second = await publishNixosSharedHostStaticWebapp({
      artifactDir: artifactV2,
      containerRoot,
      layout: container,
    });
    const publishedRelease = await fsp.realpath(second.releasePath);
    const current = await fsp.realpath(path.join(containerRoot, "srv/static-app/current"));
    const live = await fsp.realpath(path.join(containerRoot, "srv/static-app/live"));
    assert.equal(current, publishedRelease);
    assert.equal(live, publishedRelease);
    assert.notEqual(first.artifactIdentity, second.artifactIdentity);
    assert.match(await fsp.readFile(path.join(live, "index.html"), "utf8"), /v2/);
  });
});
