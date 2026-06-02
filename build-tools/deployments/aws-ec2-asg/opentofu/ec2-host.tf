locals {
  ec2_instance_profile   = element(reverse(split("/", var.ec2_instance_profile_arn)), 0)
  ec2_root_volume_digest = "sha256:${sha256(jsonencode({ encrypted = true, volume_type = "gp3" }))}"
  ec2_worker_placement = {
    worker_count       = var.ec2_worker_capacity
    placement_semantic = "workers run on the ASG host profile and coordinate through database leases"
  }
}

resource "aws_launch_template" "control_plane" {
  name_prefix            = "${var.name_prefix}-cp-"
  image_id               = var.ec2_ami_id
  instance_type          = var.ec2_instance_type
  user_data              = var.ec2_user_data_base64
  vpc_security_group_ids = var.ec2_security_group_ids

  iam_instance_profile {
    name = local.ec2_instance_profile
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      encrypted   = true
      volume_type = "gp3"
    }
  }

  tag_specifications {
    resource_type = "instance"
    tags = merge(var.tags, {
      ec2HostMode      = var.ec2_host_mode
      amiBuildIdentity = var.ec2_ami_build_identity
      amiEvidencePath  = var.ec2_ami_evidence_path
      bootstrapDigest  = var.ec2_user_data_digest
      bootstrapPath    = var.ec2_user_data_path
      rootVolumeDigest = local.ec2_root_volume_digest
      sshPosture       = "ssm-no-standing-ssh"
      logSink          = "cloudwatch"
      alarmPosture     = "required"
    })
  }
}

resource "aws_autoscaling_group" "control_plane" {
  name                = var.ec2_asg_name
  min_size            = var.ec2_service_capacity
  max_size            = var.ec2_service_capacity
  desired_capacity    = var.ec2_service_capacity
  vpc_zone_identifier = var.ec2_private_subnet_ids

  launch_template {
    id      = aws_launch_template.control_plane.id
    version = "$Latest"
  }

  tag {
    key                 = "workerPlacement"
    value               = jsonencode(local.ec2_worker_placement)
    propagate_at_launch = true
  }

  tag {
    key                 = "rollback"
    value               = "non-destructive-launch-template-version-rollback"
    propagate_at_launch = true
  }
}
