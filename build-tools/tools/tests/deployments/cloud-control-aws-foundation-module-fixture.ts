import fs from "node:fs";
import path from "node:path";
import { viberootsRepoPath } from "./deployment-command";

export const awsFoundationModuleDir = viberootsRepoPath(
  "build-tools/deployments/aws-control-plane-foundation/opentofu",
);

export const awsFoundationVariableNames = `
  region name_prefix tags vpc_cidr existing_vpc_id existing_internet_gateway_id
  public_subnet_cidrs private_subnet_cidrs availability_zones outbound_https_cidrs
  artifact_bucket_name artifact_prefix state_bucket_name state_lock_table_name
  ecr_enabled ecr_repository_name ecr_image_tag_mutability ecr_scan_on_push
  ecr_lifecycle_policy_json ecr_repository_policy_json ecr_kms_key_arn
  ecr_import_adoption_metadata
  ec2_host_mode ec2_asg_name ec2_ami_id ec2_ami_build_identity ec2_ami_evidence_path
  ec2_instance_type ec2_instance_profile_arn ec2_private_subnet_ids ec2_security_group_ids
  ec2_user_data_base64 ec2_user_data_path ec2_user_data_digest
  ec2_service_capacity ec2_worker_capacity ec2_import_adoption_metadata
  kms_deletion_window_days ingress_enabled ingress_type ingress_public_host
  ingress_callback_host ingress_callback_path ingress_service_port ingress_target_instance_id
  ingress_service_process ingress_service_unit ingress_image_digest ingress_config_digest
  ingress_target_health_status ingress_certificate_arn ingress_certificate_not_before
  ingress_certificate_not_after ingress_certificate_sans
  ingress_certificate_validation_ownership_reference ingress_certificate_validation_ownership_digest
  ingress_certificate_renewal_reference ingress_certificate_renewal_digest
  ingress_certificate_dns_validation_reference ingress_certificate_dns_validation_digest
  ingress_route53_zone_id ingress_allowed_client_cidrs ingress_waf_enabled
  supabase_privatelink_enabled supabase_privatelink_ram_share_arn
  supabase_privatelink_resource_configuration_arn
  supabase_privatelink_endpoint_subnet_ids
  supabase_privatelink_service_network_identifier
  supabase_privatelink_private_dns_enabled
  supabase_privatelink_connection_mode supabase_privatelink_import_adoption_metadata
`
  .trim()
  .split(/\s+/);

export function awsFoundationModuleSource(): string {
  return fs
    .readdirSync(awsFoundationModuleDir)
    .filter((file) => file.endsWith(".tf"))
    .map((file) => fs.readFileSync(path.join(awsFoundationModuleDir, file), "utf8"))
    .join("\n");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
