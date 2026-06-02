output "ec2_host" {
  value = {
    schemaVersion = "aws-ec2-asg-opentofu-output@1"
    identity = {
      mode                  = var.ec2_host_mode
      asg                   = aws_autoscaling_group.control_plane.name
      launchTemplateId      = aws_launch_template.control_plane.id
      launchTemplateVersion = aws_launch_template.control_plane.latest_version
    }
    instance = {
      amiId            = var.ec2_ami_id
      amiBuildIdentity = var.ec2_ami_build_identity
      amiEvidencePath  = var.ec2_ami_evidence_path
      type             = var.ec2_instance_type
      profileArn       = var.ec2_instance_profile_arn
    }
    network        = { subnetIds = var.ec2_private_subnet_ids, securityGroupIds = var.ec2_security_group_ids }
    bootstrap      = { base64 = var.ec2_user_data_base64, digest = var.ec2_user_data_digest, path = var.ec2_user_data_path }
    capacity       = { service = var.ec2_service_capacity, workers = local.ec2_worker_placement }
    posture        = { logSink = "cloudwatch", alarmPosture = "required", rollback = "launch-template-version rollback plus worker drain/shutdown evidence" }
    importAdoption = var.ec2_import_adoption_metadata
  }
}
