output "foundation_evidence" {
  value = {
    vpc_id                          = local.vpc_id
    internet_gateway_id             = local.igw_id
    nat_gateway_id                  = aws_nat_gateway.controlled_egress.id
    public_subnet_ids               = [for subnet in aws_subnet.public : subnet.id]
    private_subnet_ids              = [for subnet in aws_subnet.private : subnet.id]
    route_table_ids                 = [for table in aws_route_table.private : table.id]
    service_security_group_id       = aws_security_group.service.id
    worker_security_group_id        = aws_security_group.worker.id
    load_balancer_security_group_id = aws_security_group.load_balancer.id
    s3_endpoint_security_group_id   = aws_security_group.s3_endpoint.id
    privatelink_security_group_id   = aws_security_group.privatelink.id
    outbound_https_targets          = keys(var.outbound_https_cidrs)
    s3_endpoint_id                  = aws_vpc_endpoint.s3.id
    artifact_bucket                 = aws_s3_bucket.artifacts.bucket
    artifact_prefix                 = var.artifact_prefix
    artifact_kms_key_arn            = aws_kms_key.artifacts.arn
    ec2_instance_profile_arn        = aws_iam_instance_profile.ec2_host.arn
    ec2_host_role_arn               = aws_iam_role.ec2_host.arn
    s3_artifact_access_role_arn     = aws_iam_role.s3_artifact_access.arn
    evidence_collector_role_arn     = aws_iam_role.evidence_collector.arn
    provider_hook_role_arn          = aws_iam_role.provider_hook.arn
    artifact_bucket_policy_id       = aws_s3_bucket_policy.artifacts.id
    artifact_object_lock_id         = aws_s3_bucket_object_lock_configuration.artifacts.id
    state_bucket                    = aws_s3_bucket.state.bucket
    state_lock_table                = aws_dynamodb_table.state_lock.name
    state_backend                   = "s3"
    state_lock                      = "dynamodb"
  }
}
