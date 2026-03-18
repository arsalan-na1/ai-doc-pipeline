#!/bin/bash
# ============================================================================
# AI Document Intelligence Pipeline - Teardown Script
# Removes all AWS resources created by deploy.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "============================================="
echo "  AI Document Intelligence Pipeline"
echo "  Resource Teardown"
echo "============================================="
echo ""
echo "  WARNING: This will delete ALL resources created by the deployment."
echo ""
read -p "  Are you sure? (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "  Aborted."
    exit 0
fi

# Load configuration
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
else
    echo "[!] No .env file found. Cannot determine resource names."
    exit 1
fi

ROLE_NAME="ai-doc-pipeline-lambda-role"
PROCESSOR_FUNCTION="ai-doc-processor"
API_FUNCTION="ai-doc-results-api"
LAYER_NAME="ai-doc-pipeline-deps"
API_NAME="ai-doc-pipeline-api"

echo ""

# Step 0: Disable CloudFront Distribution
echo "[0/9] Disabling CloudFront distribution..."
CF_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='AI Document Pipeline Frontend'].Id" --output text 2>/dev/null || echo "")
if [ -n "$CF_ID" ] && [ "$CF_ID" != "None" ]; then
    # Get the current config and ETag
    CF_CONFIG=$(aws cloudfront get-distribution-config --id "$CF_ID" 2>/dev/null || echo "")
    CF_ETAG=$(echo "$CF_CONFIG" | python3 -c "import sys,json; print(json.load(sys.stdin)['ETag'])" 2>/dev/null || echo "")
    if [ -n "$CF_ETAG" ]; then
        # Disable the distribution first (required before deletion)
        echo "$CF_CONFIG" | python3 -c "
import sys, json
d = json.load(sys.stdin)
c = d['DistributionConfig']
c['Enabled'] = False
print(json.dumps(c))
" > /tmp/cf-disable.json
        aws cloudfront update-distribution --id "$CF_ID" --if-match "$CF_ETAG" \
            --distribution-config file:///tmp/cf-disable.json >/dev/null 2>&1 || true
        rm -f /tmp/cf-disable.json
        echo "  Disabled CloudFront distribution: $CF_ID"
        echo "  Note: Distribution must finish deploying before it can be deleted."
        echo "  Run 'aws cloudfront delete-distribution --id $CF_ID --if-match <ETAG>' after it's fully disabled."
    fi
else
    echo "  No CloudFront distribution found."
fi

# Step 1: Delete API Gateway
echo "[1/9] Deleting API Gateway..."
API_ID=$(aws apigateway get-rest-apis --region "$AWS_REGION" \
    --query "items[?name=='$API_NAME'].id" --output text 2>/dev/null || echo "")
if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
    aws apigateway delete-rest-api --rest-api-id "$API_ID" --region "$AWS_REGION"
    echo "  Deleted API Gateway: $API_ID"
else
    echo "  API Gateway not found, skipping."
fi

# Step 2: Delete Lambda Functions
echo "[2/8] Deleting Lambda functions..."
for FUNC in "$PROCESSOR_FUNCTION" "$API_FUNCTION"; do
    if aws lambda get-function --function-name "$FUNC" --region "$AWS_REGION" > /dev/null 2>&1; then
        aws lambda delete-function --function-name "$FUNC" --region "$AWS_REGION"
        echo "  Deleted: $FUNC"
    else
        echo "  $FUNC not found, skipping."
    fi
done

# Step 3: Delete Lambda Layer (all versions)
echo "[3/8] Deleting Lambda Layer versions..."
LAYER_VERSIONS=$(aws lambda list-layer-versions --layer-name "$LAYER_NAME" --region "$AWS_REGION" \
    --query 'LayerVersions[].Version' --output text 2>/dev/null || echo "")
if [ -n "$LAYER_VERSIONS" ] && [ "$LAYER_VERSIONS" != "None" ]; then
    for VERSION in $LAYER_VERSIONS; do
        aws lambda delete-layer-version --layer-name "$LAYER_NAME" --version-number "$VERSION" --region "$AWS_REGION"
        echo "  Deleted layer version: $VERSION"
    done
else
    echo "  No layer versions found, skipping."
fi

# Step 4: Delete IAM Role
echo "[4/8] Deleting IAM role..."
if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
    # Delete inline policies first
    POLICIES=$(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text)
    for POLICY in $POLICIES; do
        aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY"
        echo "  Deleted inline policy: $POLICY"
    done
    aws iam delete-role --role-name "$ROLE_NAME"
    echo "  Deleted role: $ROLE_NAME"
else
    echo "  Role not found, skipping."
fi

# Step 5: Delete DynamoDB Table
echo "[5/8] Deleting DynamoDB table..."
if aws dynamodb describe-table --table-name "$DYNAMODB_TABLE_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
    aws dynamodb delete-table --table-name "$DYNAMODB_TABLE_NAME" --region "$AWS_REGION" > /dev/null
    echo "  Deleted table: $DYNAMODB_TABLE_NAME"
else
    echo "  Table not found, skipping."
fi

# Step 6: Delete SSM Parameter
echo "[6/8] Deleting SSM parameter..."
aws ssm delete-parameter --name "$SSM_PARAMETER_NAME" --region "$AWS_REGION" 2>/dev/null \
    && echo "  Deleted: $SSM_PARAMETER_NAME" \
    || echo "  Parameter not found, skipping."

# Step 7: Empty and delete S3 upload bucket
echo "[7/8] Deleting S3 upload bucket..."
if aws s3api head-bucket --bucket "$S3_BUCKET_NAME" 2>/dev/null; then
    aws s3 rm "s3://$S3_BUCKET_NAME" --recursive
    aws s3api delete-bucket --bucket "$S3_BUCKET_NAME" --region "$AWS_REGION"
    echo "  Deleted bucket: $S3_BUCKET_NAME"
else
    echo "  Bucket not found, skipping."
fi

# Step 8: Empty and delete S3 frontend bucket
echo "[8/8] Deleting S3 frontend bucket..."
if aws s3api head-bucket --bucket "$S3_FRONTEND_BUCKET_NAME" 2>/dev/null; then
    aws s3 rm "s3://$S3_FRONTEND_BUCKET_NAME" --recursive
    aws s3api delete-bucket --bucket "$S3_FRONTEND_BUCKET_NAME" --region "$AWS_REGION"
    echo "  Deleted bucket: $S3_FRONTEND_BUCKET_NAME"
else
    echo "  Bucket not found, skipping."
fi

echo ""
echo "============================================="
echo "  TEARDOWN COMPLETE"
echo "  All resources have been removed."
echo "============================================="
