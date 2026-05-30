data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2_host" {
  name_prefix        = "${var.name_prefix}-host-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role" "s3_artifact_access" {
  name_prefix        = "${var.name_prefix}-artifact-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role" "evidence_collector" {
  name_prefix        = "${var.name_prefix}-evidence-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role" "provider_hook" {
  name_prefix        = "${var.name_prefix}-provider-hook-"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_instance_profile" "ec2_host" {
  name_prefix = "${var.name_prefix}-host-"
  role        = aws_iam_role.ec2_host.name
}

data "aws_iam_policy_document" "host_operation" {
  statement {
    actions = [
      "cloudwatch:PutMetricData",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "host_operation" {
  name_prefix = "${var.name_prefix}-host-operation-"
  policy      = data.aws_iam_policy_document.host_operation.json
}

resource "aws_iam_role_policy_attachment" "host_operation" {
  role       = aws_iam_role.ec2_host.name
  policy_arn = aws_iam_policy.host_operation.arn
}

data "aws_iam_policy_document" "artifact_access" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListBucket"]
    resources = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/${var.artifact_prefix}*"]
  }
}

resource "aws_iam_policy" "artifact_access" {
  name_prefix = "${var.name_prefix}-artifact-"
  policy      = data.aws_iam_policy_document.artifact_access.json
}

resource "aws_iam_role_policy_attachment" "artifact_access" {
  role       = aws_iam_role.s3_artifact_access.name
  policy_arn = aws_iam_policy.artifact_access.arn
}

data "aws_iam_policy_document" "evidence_collector" {
  statement {
    actions = [
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVpcEndpoints",
      "ec2:DescribeVpcs",
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "s3:GetBucketEncryption",
      "s3:GetBucketLifecycleConfiguration",
      "s3:GetBucketPolicy",
      "s3:GetBucketVersioning",
      "s3:GetObjectLockConfiguration",
      "s3:GetPublicAccessBlock",
      "servicequotas:GetServiceQuota",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "evidence_collector" {
  name_prefix = "${var.name_prefix}-evidence-"
  policy      = data.aws_iam_policy_document.evidence_collector.json
}

resource "aws_iam_role_policy_attachment" "evidence_collector" {
  role       = aws_iam_role.evidence_collector.name
  policy_arn = aws_iam_policy.evidence_collector.arn
}

data "aws_iam_policy_document" "provider_hook" {
  statement {
    actions = [
      "ec2:DescribeInternetGateways",
      "ec2:DescribeNatGateways",
      "ec2:DescribeRouteTables",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeVpcEndpoints",
      "ec2:DescribeVpcs",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeTargetGroups",
      "servicequotas:GetServiceQuota",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
    ]
    resources = [
      aws_iam_role.ec2_host.arn,
      aws_iam_role.evidence_collector.arn,
      aws_iam_role.provider_hook.arn,
      aws_iam_role.s3_artifact_access.arn,
    ]
  }

  statement {
    actions = [
      "s3:GetBucketEncryption",
      "s3:GetBucketLifecycleConfiguration",
      "s3:GetBucketPolicy",
      "s3:GetBucketVersioning",
      "s3:GetObjectLockConfiguration",
      "s3:GetPublicAccessBlock",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.artifacts.arn]
  }
}

resource "aws_iam_policy" "provider_hook" {
  name_prefix = "${var.name_prefix}-provider-hook-"
  policy      = data.aws_iam_policy_document.provider_hook.json
}

resource "aws_iam_role_policy_attachment" "provider_hook" {
  role       = aws_iam_role.provider_hook.name
  policy_arn = aws_iam_policy.provider_hook.arn
}
