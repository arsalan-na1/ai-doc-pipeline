#!/bin/bash
# ============================================================================
# AI Document Intelligence Pipeline - Full Deployment Script
# Deploys all AWS resources using AWS CLI (Free Tier only)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# On Git Bash (MSYS), convert paths for file:// and fileb:// references
if [[ "${OSTYPE:-}" == "msys" ]] || [[ "${OSTYPE:-}" == "mingw"* ]]; then
    FILE_PREFIX="$(cygpath -w "$SCRIPT_DIR" | sed 's|\\|/|g')"
    PROJECT_FILE_PREFIX="$(cygpath -w "$PROJECT_DIR" | sed 's|\\|/|g')"
else
    FILE_PREFIX="$SCRIPT_DIR"
    PROJECT_FILE_PREFIX="$PROJECT_DIR"
fi

echo "============================================="
echo "  AI Document Intelligence Pipeline"
echo "  Full Stack Deployment"
echo "============================================="

# ---- Load Configuration ----
if [ -f "$PROJECT_DIR/.env" ]; then
    echo "[*] Loading configuration from .env..."
    set -a
    source "$PROJECT_DIR/.env"
    set +a
else
    echo "[!] No .env file found. Copy .env.example to .env and fill in your values."
    exit 1
fi

# Validate required variables
for var in AWS_REGION AWS_ACCOUNT_ID S3_BUCKET_NAME S3_FRONTEND_BUCKET_NAME DYNAMODB_TABLE_NAME SSM_PARAMETER_NAME OPENAI_API_KEY; do
    if [ -z "${!var:-}" ]; then
        echo "[ERROR] Required variable $var is not set. Check your .env file."
        exit 1
    fi
done

ROLE_NAME="ai-doc-pipeline-lambda-role"
PROCESSOR_FUNCTION="ai-doc-processor"
API_FUNCTION="ai-doc-results-api"
LAYER_NAME="ai-doc-pipeline-deps"
API_NAME="ai-doc-pipeline-api"

echo ""
echo "Configuration:"
echo "  Region:           $AWS_REGION"
echo "  S3 Bucket:        $S3_BUCKET_NAME"
echo "  Frontend Bucket:  $S3_FRONTEND_BUCKET_NAME"
echo "  DynamoDB Table:   $DYNAMODB_TABLE_NAME"
echo "  SSM Parameter:    $SSM_PARAMETER_NAME"
echo ""

# ============================================================================
# Step 1: Create S3 Bucket for Document Uploads
# ============================================================================
echo "========================================="
echo "[Step 1/11] Creating S3 upload bucket..."
echo "========================================="

if aws s3api head-bucket --bucket "$S3_BUCKET_NAME" 2>/dev/null; then
    echo "  Bucket $S3_BUCKET_NAME already exists, skipping."
else
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$S3_BUCKET_NAME" --region "$AWS_REGION"
    else
        aws s3api create-bucket --bucket "$S3_BUCKET_NAME" --region "$AWS_REGION" \
            --create-bucket-configuration LocationConstraint="$AWS_REGION"
    fi
    echo "  Created bucket: $S3_BUCKET_NAME"
fi

# Block public access on upload bucket
aws s3api put-public-access-block --bucket "$S3_BUCKET_NAME" \
    --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "  Public access blocked."

# ============================================================================
# Step 2: Store OpenAI API Key in SSM Parameter Store
# ============================================================================
echo ""
echo "========================================="
echo "[Step 2/11] Storing OpenAI API key in SSM..."
echo "========================================="

aws ssm put-parameter \
    --name "$SSM_PARAMETER_NAME" \
    --type SecureString \
    --value "$OPENAI_API_KEY" \
    --overwrite \
    --region "$AWS_REGION" > /dev/null
echo "  Stored API key at: $SSM_PARAMETER_NAME"

# ============================================================================
# Step 3: Create DynamoDB Table
# ============================================================================
echo ""
echo "========================================="
echo "[Step 3/11] Creating DynamoDB table..."
echo "========================================="

if aws dynamodb describe-table --table-name "$DYNAMODB_TABLE_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
    echo "  Table $DYNAMODB_TABLE_NAME already exists, skipping."
else
    aws dynamodb create-table \
        --table-name "$DYNAMODB_TABLE_NAME" \
        --attribute-definitions AttributeName=document_id,AttributeType=S \
        --key-schema AttributeName=document_id,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "$AWS_REGION" > /dev/null
    echo "  Created table: $DYNAMODB_TABLE_NAME"
    echo "  Waiting for table to become active..."
    aws dynamodb wait table-exists --table-name "$DYNAMODB_TABLE_NAME" --region "$AWS_REGION"
    echo "  Table is active."

    # Add GSI for session-based document isolation
    aws dynamodb update-table \
        --table-name "$DYNAMODB_TABLE_NAME" \
        --attribute-definitions AttributeName=session_id,AttributeType=S \
        --global-secondary-index-updates '[{"Create":{"IndexName":"session_id-index","KeySchema":[{"AttributeName":"session_id","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}}]' \
        --region "$AWS_REGION" > /dev/null
    echo "  Created GSI: session_id-index"
    echo "  Waiting for GSI to become active..."
    aws dynamodb wait table-exists --table-name "$DYNAMODB_TABLE_NAME" --region "$AWS_REGION"
fi

# ============================================================================
# Step 4: Create IAM Role for Lambda
# ============================================================================
echo ""
echo "========================================="
echo "[Step 4/11] Creating IAM role..."
echo "========================================="

if aws iam get-role --role-name "$ROLE_NAME" > /dev/null 2>&1; then
    echo "  Role $ROLE_NAME already exists, skipping creation."
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
else
    ROLE_ARN=$(aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "file://$FILE_PREFIX/trust-policy.json" \
        --query 'Role.Arn' --output text)
    echo "  Created role: $ROLE_NAME"
fi

# Attach inline policy with least-privilege permissions
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:*"
    },
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::${S3_BUCKET_NAME}/*"
    },
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:${AWS_REGION}:${AWS_ACCOUNT_ID}:table/${DYNAMODB_TABLE_NAME}",
        "arn:aws:dynamodb:${AWS_REGION}:${AWS_ACCOUNT_ID}:table/${DYNAMODB_TABLE_NAME}/index/*"
      ]
    },
    {
      "Sid": "SSMAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter${SSM_PARAMETER_NAME}"
    }
  ]
}
EOF
)

aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "ai-doc-pipeline-policy" \
    --policy-document "$POLICY_DOC"
echo "  Attached least-privilege inline policy."

echo "  Waiting 10s for IAM role propagation..."
sleep 10

# ============================================================================
# Step 5: Publish Lambda Layer
# ============================================================================
echo ""
echo "========================================="
echo "[Step 5/11] Publishing Lambda Layer..."
echo "========================================="

LAYER_ZIP="$PROJECT_DIR/lambda/layer/lambda-layer.zip"
LAYER_ZIP_WIN="$PROJECT_FILE_PREFIX/lambda/layer/lambda-layer.zip"
if [ ! -f "$LAYER_ZIP" ]; then
    echo "  [!] Layer zip not found at: $LAYER_ZIP"
    echo "  Run 'bash lambda/layer/build_layer.sh' first to build the layer."
    exit 1
fi

LAYER_VERSION_ARN=$(aws lambda publish-layer-version \
    --layer-name "$LAYER_NAME" \
    --compatible-runtimes python3.11 \
    --zip-file "fileb://$LAYER_ZIP_WIN" \
    --region "$AWS_REGION" \
    --query 'LayerVersionArn' --output text)
echo "  Published layer: $LAYER_VERSION_ARN"

# ============================================================================
# Step 6: Deploy Document Processor Lambda
# ============================================================================
echo ""
echo "========================================="
echo "[Step 6/11] Deploying document processor Lambda..."
echo "========================================="

PROCESSOR_ZIP="$SCRIPT_DIR/processor.zip"
PROCESSOR_ZIP_WIN="$FILE_PREFIX/processor.zip"
cd "$PROJECT_DIR/lambda/document_processor"
powershell -Command "Compress-Archive -Path '*' -DestinationPath '$PROCESSOR_ZIP_WIN' -Force" > /dev/null
cd "$PROJECT_DIR"

if aws lambda get-function --function-name "$PROCESSOR_FUNCTION" --region "$AWS_REGION" > /dev/null 2>&1; then
    aws lambda update-function-code \
        --function-name "$PROCESSOR_FUNCTION" \
        --zip-file "fileb://$PROCESSOR_ZIP_WIN" \
        --region "$AWS_REGION" > /dev/null
    echo "  Updated function code: $PROCESSOR_FUNCTION"
else
    aws lambda create-function \
        --function-name "$PROCESSOR_FUNCTION" \
        --runtime python3.11 \
        --handler lambda_function.lambda_handler \
        --role "$ROLE_ARN" \
        --zip-file "fileb://$PROCESSOR_ZIP_WIN" \
        --timeout 60 \
        --memory-size 512 \
        --layers "$LAYER_VERSION_ARN" \
        --environment "Variables={DYNAMODB_TABLE=$DYNAMODB_TABLE_NAME,SSM_PARAMETER_NAME=$SSM_PARAMETER_NAME}" \
        --region "$AWS_REGION" > /dev/null
    echo "  Created function: $PROCESSOR_FUNCTION"
fi

rm -f "$PROCESSOR_ZIP"

# ============================================================================
# Step 7: Add S3 Trigger to Document Processor
# ============================================================================
echo ""
echo "========================================="
echo "[Step 7/11] Configuring S3 trigger..."
echo "========================================="

PROCESSOR_ARN=$(aws lambda get-function --function-name "$PROCESSOR_FUNCTION" \
    --region "$AWS_REGION" --query 'Configuration.FunctionArn' --output text)

# Add permission for S3 to invoke the Lambda
aws lambda add-permission \
    --function-name "$PROCESSOR_FUNCTION" \
    --statement-id "s3-trigger-permission" \
    --action "lambda:InvokeFunction" \
    --principal "s3.amazonaws.com" \
    --source-arn "arn:aws:s3:::$S3_BUCKET_NAME" \
    --region "$AWS_REGION" 2>/dev/null || echo "  Permission already exists."

# Configure S3 bucket notification
NOTIFICATION_CONFIG=$(cat <<EOF
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "$PROCESSOR_ARN",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "prefix", "Value": "uploads/"},
            {"Name": "suffix", "Value": ".pdf"}
          ]
        }
      }
    }
  ]
}
EOF
)

aws s3api put-bucket-notification-configuration \
    --bucket "$S3_BUCKET_NAME" \
    --notification-configuration "$NOTIFICATION_CONFIG"
echo "  S3 trigger configured for uploads/*.pdf"

# ============================================================================
# Step 8: Deploy Results API Lambda
# ============================================================================
echo ""
echo "========================================="
echo "[Step 8/11] Deploying results API Lambda..."
echo "========================================="

API_ZIP="$SCRIPT_DIR/api.zip"
API_ZIP_WIN="$FILE_PREFIX/api.zip"
cd "$PROJECT_DIR/lambda/results_api"
powershell -Command "Compress-Archive -Path '*' -DestinationPath '$API_ZIP_WIN' -Force" > /dev/null
cd "$PROJECT_DIR"

if aws lambda get-function --function-name "$API_FUNCTION" --region "$AWS_REGION" > /dev/null 2>&1; then
    aws lambda update-function-code \
        --function-name "$API_FUNCTION" \
        --zip-file "fileb://$API_ZIP_WIN" \
        --region "$AWS_REGION" > /dev/null
    echo "  Updated function code: $API_FUNCTION"
else
    aws lambda create-function \
        --function-name "$API_FUNCTION" \
        --runtime python3.11 \
        --handler lambda_function.lambda_handler \
        --role "$ROLE_ARN" \
        --zip-file "fileb://$API_ZIP_WIN" \
        --timeout 10 \
        --memory-size 128 \
        --layers "$LAYER_VERSION_ARN" \
        --environment "Variables={DYNAMODB_TABLE=$DYNAMODB_TABLE_NAME,S3_BUCKET=$S3_BUCKET_NAME,SSM_PARAMETER_NAME=$SSM_PARAMETER_NAME}" \
        --region "$AWS_REGION" > /dev/null
    echo "  Created function: $API_FUNCTION"
fi

rm -f "$API_ZIP"

# ============================================================================
# Step 9: Create API Gateway
# ============================================================================
echo ""
echo "========================================="
echo "[Step 9/11] Creating API Gateway..."
echo "========================================="

API_FUNCTION_ARN=$(aws lambda get-function --function-name "$API_FUNCTION" \
    --region "$AWS_REGION" --query 'Configuration.FunctionArn' --output text)

# Check if API already exists
EXISTING_API_ID=$(aws apigateway get-rest-apis --region "$AWS_REGION" \
    --query "items[?name=='$API_NAME'].id" --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_API_ID" ] && [ "$EXISTING_API_ID" != "None" ]; then
    API_ID="$EXISTING_API_ID"
    echo "  API Gateway already exists: $API_ID"
else
    API_ID=$(aws apigateway create-rest-api \
        --name "$API_NAME" \
        --description "AI Document Intelligence Pipeline API" \
        --endpoint-configuration types=REGIONAL \
        --region "$AWS_REGION" \
        --query 'id' --output text)
    echo "  Created API Gateway: $API_ID"
fi

ROOT_ID=$(aws apigateway get-resources --rest-api-id "$API_ID" --region "$AWS_REGION" \
    --query 'items[?path==`/`].id' --output text)

# Helper function to create resource + GET method + Lambda integration
create_api_resource() {
    local PARENT_ID=$1
    local PATH_PART=$2
    local IS_PROXY=${3:-false}

    # Check if resource exists
    local RESOURCE_ID
    if [ "$IS_PROXY" = "true" ]; then
        RESOURCE_ID=$(aws apigateway get-resources --rest-api-id "$API_ID" --region "$AWS_REGION" \
            --query "items[?pathPart=='$PATH_PART'].id" --output text 2>/dev/null || echo "")
    else
        RESOURCE_ID=$(aws apigateway get-resources --rest-api-id "$API_ID" --region "$AWS_REGION" \
            --query "items[?pathPart=='$PATH_PART'].id" --output text 2>/dev/null || echo "")
    fi

    if [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" = "None" ]; then
        RESOURCE_ID=$(aws apigateway create-resource \
            --rest-api-id "$API_ID" \
            --parent-id "$PARENT_ID" \
            --path-part "$PATH_PART" \
            --region "$AWS_REGION" \
            --query 'id' --output text)
    fi

    echo "$RESOURCE_ID"
}

setup_method() {
    local RESOURCE_ID=$1
    local METHOD=$2

    # Create method
    aws apigateway put-method \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method "$METHOD" \
        --authorization-type NONE \
        --region "$AWS_REGION" > /dev/null 2>&1 || true

    # Create Lambda integration
    aws apigateway put-integration \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method "$METHOD" \
        --type AWS_PROXY \
        --integration-http-method POST \
        --uri "arn:aws:apigateway:${AWS_REGION}:lambda:path/2015-03-31/functions/${API_FUNCTION_ARN}/invocations" \
        --region "$AWS_REGION" > /dev/null 2>&1 || true
}

setup_cors() {
    local RESOURCE_ID=$1

    aws apigateway put-method \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method OPTIONS \
        --authorization-type NONE \
        --region "$AWS_REGION" > /dev/null 2>&1 || true

    aws apigateway put-integration \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method OPTIONS \
        --type MOCK \
        --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
        --region "$AWS_REGION" > /dev/null 2>&1 || true

    aws apigateway put-method-response \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method OPTIONS \
        --status-code 200 \
        --response-parameters '{"method.response.header.Access-Control-Allow-Headers":false,"method.response.header.Access-Control-Allow-Methods":false,"method.response.header.Access-Control-Allow-Origin":false}' \
        --region "$AWS_REGION" > /dev/null 2>&1 || true

    aws apigateway put-integration-response \
        --rest-api-id "$API_ID" \
        --resource-id "$RESOURCE_ID" \
        --http-method OPTIONS \
        --status-code 200 \
        --response-parameters '{"method.response.header.Access-Control-Allow-Headers":"'"'"'Content-Type'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'GET,POST,OPTIONS'"'"'","method.response.header.Access-Control-Allow-Origin":"'"'"'*'"'"'"}' \
        --region "$AWS_REGION" > /dev/null 2>&1 || true
}

echo "  Creating API resources..."

# /upload-url
UPLOAD_URL_ID=$(create_api_resource "$ROOT_ID" "upload-url")
setup_method "$UPLOAD_URL_ID" "GET"
setup_cors "$UPLOAD_URL_ID"

# /documents
DOCUMENTS_ID=$(create_api_resource "$ROOT_ID" "documents")
setup_method "$DOCUMENTS_ID" "GET"
setup_cors "$DOCUMENTS_ID"

# /documents/{id}
DOC_ID_RESOURCE=$(create_api_resource "$DOCUMENTS_ID" "{id}")
setup_method "$DOC_ID_RESOURCE" "GET"
setup_cors "$DOC_ID_RESOURCE"

# Add Lambda permission for API Gateway
aws lambda add-permission \
    --function-name "$API_FUNCTION" \
    --statement-id "apigateway-invoke" \
    --action "lambda:InvokeFunction" \
    --principal "apigateway.amazonaws.com" \
    --source-arn "arn:aws:execute-api:${AWS_REGION}:${AWS_ACCOUNT_ID}:${API_ID}/*" \
    --region "$AWS_REGION" 2>/dev/null || echo "  API Gateway permission already exists."

# Deploy API
aws apigateway create-deployment \
    --rest-api-id "$API_ID" \
    --stage-name "prod" \
    --region "$AWS_REGION" > /dev/null
echo "  API deployed to prod stage."

API_URL="https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com/prod"
echo "  API URL: $API_URL"

# ============================================================================
# Step 10: Create Frontend S3 Bucket (Static Website)
# ============================================================================
echo ""
echo "========================================="
echo "[Step 10/11] Setting up frontend hosting..."
echo "========================================="

if aws s3api head-bucket --bucket "$S3_FRONTEND_BUCKET_NAME" 2>/dev/null; then
    echo "  Frontend bucket already exists."
else
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3api create-bucket --bucket "$S3_FRONTEND_BUCKET_NAME" --region "$AWS_REGION"
    else
        aws s3api create-bucket --bucket "$S3_FRONTEND_BUCKET_NAME" --region "$AWS_REGION" \
            --create-bucket-configuration LocationConstraint="$AWS_REGION"
    fi
    echo "  Created frontend bucket: $S3_FRONTEND_BUCKET_NAME"
fi

# Enable static website hosting
aws s3 website "s3://$S3_FRONTEND_BUCKET_NAME" --index-document index.html

# Allow public read access
aws s3api delete-public-access-block --bucket "$S3_FRONTEND_BUCKET_NAME" 2>/dev/null || true

BUCKET_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${S3_FRONTEND_BUCKET_NAME}/*"
    }
  ]
}
EOF
)

aws s3api put-bucket-policy --bucket "$S3_FRONTEND_BUCKET_NAME" --policy "$BUCKET_POLICY"

# Inject API URL into frontend and upload
FRONTEND_FILE="$PROJECT_DIR/frontend/index.html"
if [ -f "$FRONTEND_FILE" ]; then
    # Replace placeholder API URL with actual URL
    TEMP_HTML="$SCRIPT_DIR/_index_tmp.html"
    sed "s|__API_BASE_URL__|$API_URL|g" "$FRONTEND_FILE" > "$TEMP_HTML"
    aws s3 cp "$TEMP_HTML" "s3://$S3_FRONTEND_BUCKET_NAME/index.html" \
        --content-type "text/html"
    rm -f "$TEMP_HTML"
    echo "  Frontend uploaded with API URL injected."
else
    echo "  [!] Frontend file not found at: $FRONTEND_FILE"
fi

S3_FRONTEND_URL="http://${S3_FRONTEND_BUCKET_NAME}.s3-website-${AWS_REGION}.amazonaws.com"

# ============================================================================
# Step 11: Create CloudFront Distribution (HTTPS)
# ============================================================================
echo ""
echo "[11/12] Creating CloudFront distribution for HTTPS..."

CALLER_REF="ai-doc-pipeline-$(date +%s)"

CF_OUTPUT=$(aws cloudfront create-distribution --cli-input-json '{
  "DistributionConfig": {
    "CallerReference": "'"$CALLER_REF"'",
    "Comment": "AI Document Pipeline Frontend",
    "Enabled": true,
    "DefaultRootObject": "index.html",
    "Origins": {
      "Quantity": 1,
      "Items": [
        {
          "Id": "S3-frontend",
          "DomainName": "'"$S3_FRONTEND_BUCKET_NAME"'.s3-website-'"$AWS_REGION"'.amazonaws.com",
          "CustomOriginConfig": {
            "HTTPPort": 80,
            "HTTPSPort": 443,
            "OriginProtocolPolicy": "http-only"
          }
        }
      ]
    },
    "DefaultCacheBehavior": {
      "TargetOriginId": "S3-frontend",
      "ViewerProtocolPolicy": "redirect-to-https",
      "AllowedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      },
      "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
      "Compress": true
    },
    "ViewerCertificate": {
      "CloudFrontDefaultCertificate": true
    },
    "PriceClass": "PriceClass_100"
  }
}' 2>&1) || true

CF_DOMAIN=$(echo "$CF_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['DomainName'])" 2>/dev/null || echo "")
CF_ID=$(echo "$CF_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['Id'])" 2>/dev/null || echo "")

if [ -n "$CF_DOMAIN" ]; then
    FRONTEND_URL="https://$CF_DOMAIN"
    echo "  CloudFront distribution created: $CF_ID"
    echo "  HTTPS URL: $FRONTEND_URL"
    echo "  Note: Distribution takes 5-10 minutes to deploy globally."
else
    echo "  [!] CloudFront creation failed or already exists. Using S3 URL."
    FRONTEND_URL="$S3_FRONTEND_URL"
fi

# ============================================================================
# Step 12: Print Summary
# ============================================================================
echo ""
echo "============================================="
echo "  DEPLOYMENT COMPLETE!"
echo "============================================="
echo ""
echo "  Frontend URL:    $FRONTEND_URL"
if [ -n "$CF_DOMAIN" ]; then
echo "  S3 URL (HTTP):   $S3_FRONTEND_URL"
echo "  CloudFront ID:   $CF_ID"
fi
echo "  API URL:         $API_URL"
echo "  Upload Bucket:   $S3_BUCKET_NAME"
echo "  DynamoDB Table:  $DYNAMODB_TABLE_NAME"
echo ""
echo "  To test:"
echo "    1. Open $FRONTEND_URL in your browser"
echo "    2. Upload a resume PDF"
echo "    3. Wait ~30 seconds for processing"
echo "    4. View the parsed results"
echo ""
echo "  To tear down all resources:"
echo "    bash deploy/teardown.sh"
echo "============================================="
