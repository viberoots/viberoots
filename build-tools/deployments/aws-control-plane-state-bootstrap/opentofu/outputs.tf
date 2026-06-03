output "state_bootstrap_evidence" {
  description = "Machine-readable evidence for the OpenTofu remote state bootstrap."
  value = {
    schemaVersion      = "aws-control-plane-state-bootstrap@1"
    region             = var.region
    stateBucketName    = aws_s3_bucket.state.bucket
    stateLockTableName = aws_dynamodb_table.state_lock.name
    backend = {
      bucket         = aws_s3_bucket.state.bucket
      key            = var.backend_state_key
      region         = var.region
      dynamodb_table = aws_dynamodb_table.state_lock.name
      encrypt        = true
    }
    safeguards = {
      bucketForceDestroy          = aws_s3_bucket.state.force_destroy
      bucketPublicAccessBlocked   = true
      bucketVersioning            = "Enabled"
      bucketServerSideEncryption  = "AES256"
      lockTableBillingMode        = aws_dynamodb_table.state_lock.billing_mode
      lockTablePointInTimeRestore = true
    }
  }
}
