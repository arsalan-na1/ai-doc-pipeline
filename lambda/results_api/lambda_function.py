"""
Results API Lambda
Handles API Gateway requests for document listing, detail retrieval, and presigned upload URLs.
"""

import json
import os
import uuid
import logging
from decimal import Decimal

import boto3
from openai import OpenAI

# --- Configuration ---
DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]
S3_BUCKET = os.environ["S3_BUCKET"]
SSM_PARAMETER_NAME = os.environ["SSM_PARAMETER_NAME"]

# --- Logging ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- AWS Clients ---
s3_client = boto3.client("s3")
ssm_client = boto3.client("ssm")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DYNAMODB_TABLE)

# --- CORS Headers ---
CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# --- OpenAI API Key Cache ---
_openai_api_key = None

# --- Job Match System Prompt ---
JOB_MATCH_SYSTEM_PROMPT = """You are an expert resume-to-job-description matcher. Given a candidate's parsed resume data and a job description, analyze how well the candidate matches the role.

You MUST return a JSON object with exactly these fields (no others):
- "match_score": an integer from 0 to 100 representing overall match percentage
- "strong_matches": an array of strings listing skills/experience the candidate clearly has that the job requires
- "missing_keywords": an array of strings listing important keywords/skills from the job description absent from the resume
- "tailoring_tips": an array of 2 to 4 strings with specific actionable advice for tailoring the resume to this job

These field names are hard requirements. Do not rename, omit, or add fields."""


class DecimalEncoder(json.JSONEncoder):
    """Handle Decimal types from DynamoDB."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj) if obj % 1 else int(obj)
        return super().default(obj)


def response(status_code, body):
    """Build API Gateway proxy response."""
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def get_openai_api_key():
    """Retrieve and cache the OpenAI API key from SSM Parameter Store."""
    global _openai_api_key
    if _openai_api_key is None:
        result = ssm_client.get_parameter(
            Name=SSM_PARAMETER_NAME,
            WithDecryption=True,
        )
        _openai_api_key = result["Parameter"]["Value"]
    return _openai_api_key


def get_upload_url(session_id):
    """Generate a presigned S3 PUT URL for PDF upload."""
    file_id = str(uuid.uuid4())
    key = f"uploads/{session_id}/{file_id}.pdf"

    presigned_url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": S3_BUCKET,
            "Key": key,
            "ContentType": "application/pdf",
        },
        ExpiresIn=300,  # 5 minutes
    )

    logger.info("Generated presigned upload URL for key: %s", key)
    return response(200, {"upload_url": presigned_url, "document_key": key, "file_id": file_id})


def list_documents(session_id):
    """List documents for a specific session from DynamoDB."""
    if not session_id:
        return response(200, {"documents": [], "count": 0})

    result = table.query(
        IndexName="session_id-index",
        KeyConditionExpression="session_id = :sid",
        ExpressionAttributeValues={":sid": session_id},
        Limit=50,
    )
    items = result.get("Items", [])

    # Sort by upload timestamp descending
    items.sort(key=lambda x: x.get("upload_timestamp", ""), reverse=True)

    # Return summary view (exclude full parsed_data and analysis for list view)
    documents = []
    for item in items:
        doc = {
            "document_id": item["document_id"],
            "filename": item.get("filename", ""),
            "upload_timestamp": item.get("upload_timestamp", ""),
            "status": item.get("status", "UNKNOWN"),
        }
        # Include name from parsed data if available
        parsed = item.get("parsed_data", {})
        if isinstance(parsed, dict):
            doc["candidate_name"] = parsed.get("name", "")
        documents.append(doc)

    logger.info("Listed %d documents", len(documents))
    return response(200, {"documents": documents, "count": len(documents)})


def get_document(document_id):
    """Get a single document's full details."""
    result = table.get_item(Key={"document_id": document_id})
    item = result.get("Item")

    if not item:
        logger.warning("Document not found: %s", document_id)
        return response(404, {"error": "Document not found"})

    logger.info("Retrieved document: %s", document_id)
    return response(200, item)


def job_match(document_id, job_description):
    """Match a job description against a parsed resume document."""
    # Fetch item from DynamoDB
    result = table.get_item(Key={"document_id": document_id})
    item = result.get("Item")

    if not item:
        logger.warning("Document not found for job match: %s", document_id)
        return response(404, {"error": "Document not found"})

    parsed_data = item.get("parsed_data")
    if not parsed_data:
        logger.warning("Document %s has no parsed_data yet", document_id)
        return response(400, {"error": "Document has not yet been processed"})

    # Serialize parsed_data using DecimalEncoder for the prompt
    parsed_data_str = json.dumps(parsed_data, cls=DecimalEncoder)

    api_key = get_openai_api_key()
    client = OpenAI(api_key=api_key)

    user_message = (
        f"Resume data:\n{parsed_data_str}\n\n"
        f"Job description:\n{job_description}"
    )

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": JOB_MATCH_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        temperature=0.3,
        max_tokens=1000,
        response_format={"type": "json_object"},
    )

    result_content = completion.choices[0].message.content
    logger.info("Job match completed for document: %s", document_id)
    return response(200, json.loads(result_content))


def lambda_handler(event, context):
    """Main handler for API Gateway proxy integration."""
    logger.info("Request: %s %s", event.get("httpMethod"), event.get("path"))

    http_method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_params = event.get("pathParameters") or {}
    query_params = event.get("queryStringParameters") or {}

    # Handle CORS preflight
    if http_method == "OPTIONS":
        return response(200, {})

    try:
        session_id = query_params.get("session_id", "")

        if http_method == "GET":
            if path == "/upload-url":
                if not session_id:
                    return response(400, {"error": "session_id is required"})
                return get_upload_url(session_id)
            elif path == "/documents":
                return list_documents(session_id)
            elif path.startswith("/documents/") and path_params.get("id"):
                return get_document(path_params["id"])
            else:
                return response(404, {"error": "Not found"})

        elif http_method == "POST":
            body_str = event.get("body") or "{}"
            try:
                body = json.loads(body_str)
            except (json.JSONDecodeError, TypeError):
                body = {}

            # Route POST /documents/{id}/job-match
            if path_params.get("id") and path.endswith("/job-match"):
                doc_id = path_params["id"]
                job_description = body.get("job_description", "")

                if not job_description or not job_description.strip():
                    return response(400, {"error": "job_description is required"})
                if len(job_description) > 5000:
                    return response(400, {"error": "job_description must be 5000 characters or fewer"})

                return job_match(doc_id, job_description)
            else:
                return response(404, {"error": "Not found"})

        else:
            return response(405, {"error": "Method not allowed"})

    except Exception as e:
        logger.error("Error handling request: %s", str(e), exc_info=True)
        return response(500, {"error": "Internal server error"})
