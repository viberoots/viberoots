locals {
  ecr_lifecycle_policy = var.ecr_lifecycle_policy_json != "" ? var.ecr_lifecycle_policy_json : jsonencode({
    rules = [{
      rulePriority = 1
      description  = "retain immutable release images and expire untagged leftovers"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
  ecr_repository_policy = var.ecr_repository_policy_json != "" ? var.ecr_repository_policy_json : jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "ControlPlaneRuntimePull"
      Effect = "Allow"
      Principal = {
        AWS = aws_iam_role.ec2_host.arn
      }
      Action = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ]
    }]
  })
  ecr_kms_mode = var.ecr_kms_key_arn == "" ? "aws-managed" : "customer-managed"
}

resource "aws_ecr_repository" "control_plane" {
  count                = var.ecr_enabled ? 1 : 0
  name                 = var.ecr_repository_name
  image_tag_mutability = var.ecr_image_tag_mutability

  image_scanning_configuration {
    scan_on_push = var.ecr_scan_on_push
  }

  encryption_configuration {
    encryption_type = var.ecr_kms_key_arn == "" ? "AES256" : "KMS"
    kms_key         = var.ecr_kms_key_arn == "" ? null : var.ecr_kms_key_arn
  }
}

resource "aws_ecr_lifecycle_policy" "control_plane" {
  count      = var.ecr_enabled ? 1 : 0
  repository = aws_ecr_repository.control_plane[0].name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_repository_policy" "control_plane" {
  count      = var.ecr_enabled ? 1 : 0
  repository = aws_ecr_repository.control_plane[0].name
  policy     = local.ecr_repository_policy
}
