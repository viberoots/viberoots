#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

test("AWS foundation OpenTofu declares Supabase PrivateLink RAM and Lattice surface", async () => {
  const root = path.join(
    process.cwd(),
    "build-tools/deployments/aws-control-plane-foundation/opentofu",
  );
  const combined = await Promise.all(
    ["privatelink.tf", "variables-privatelink.tf", "network.tf", "outputs.tf"].map((file) =>
      fsp.readFile(path.join(root, file), "utf8"),
    ),
  ).then((parts) => parts.join("\n"));
  assert.match(combined, /aws_ram_resource_share_accepter/);
  assert.match(combined, /aws_vpc_endpoint" "supabase_privatelink"/);
  assert.match(combined, /vpc_endpoint_type\s+= "Resource"/);
  assert.match(combined, /resource_configuration_arn/);
  assert.match(combined, /aws_vpclattice_service_network_resource_association/);
  assert.match(combined, /private_dns_enabled/);
  assert.match(combined, /aws_security_group_rule" "privatelink_postgres_ingress"/);
  assert.match(combined, /routeTableIds/);
  assert.match(combined, /supabase_privatelink_import_adoption_metadata/);
});
