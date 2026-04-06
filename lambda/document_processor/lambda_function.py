"""
Document Processor Lambda
Triggered by S3 PUT events when a PDF is uploaded.
Extracts text using PyMuPDF, analyzes with OpenAI gpt-4o-mini, stores results in DynamoDB.
"""

import json
import os
import hashlib
import logging
from datetime import datetime, timezone
from decimal import Decimal

import boto3
import fitz  # PyMuPDF
import pdfplumber
from openai import OpenAI

# --- Configuration ---
DYNAMODB_TABLE = os.environ["DYNAMODB_TABLE"]
SSM_PARAMETER_NAME = os.environ["SSM_PARAMETER_NAME"]
MAX_TEXT_LENGTH = 15000  # Truncate to stay within token limits

# --- Logging ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- AWS Clients ---
s3_client = boto3.client("s3")
ssm_client = boto3.client("ssm")
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DYNAMODB_TABLE)

# --- Cached OpenAI API Key ---
_openai_api_key = None


def get_openai_api_key():
    """Fetch OpenAI API key from SSM Parameter Store (cached across invocations)."""
    global _openai_api_key
    if _openai_api_key is None:
        response = ssm_client.get_parameter(
            Name=SSM_PARAMETER_NAME, WithDecryption=True
        )
        _openai_api_key = response["Parameter"]["Value"]
        logger.info("OpenAI API key retrieved from SSM Parameter Store")
    return _openai_api_key


def extract_text_from_pdf(pdf_bytes):
    """Extract text from PDF bytes using PyMuPDF (primary) with pdfplumber fallback."""
    text = ""

    # Primary: PyMuPDF
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page in doc:
            text += page.get_text()
        doc.close()
        if text.strip():
            logger.info("Text extracted successfully with PyMuPDF (%d chars)", len(text))
            return text[:MAX_TEXT_LENGTH]
    except Exception as e:
        logger.warning("PyMuPDF extraction failed: %s", str(e))

    # Fallback: pdfplumber
    try:
        import io
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        if text.strip():
            logger.info("Text extracted successfully with pdfplumber (%d chars)", len(text))
            return text[:MAX_TEXT_LENGTH]
    except Exception as e:
        logger.warning("pdfplumber extraction failed: %s", str(e))

    logger.error("Both PDF extraction methods failed or returned empty text")
    return text[:MAX_TEXT_LENGTH] if text else ""


SYSTEM_PROMPT = """You are a resume parser. Given the text of a resume, extract structured information and return it as JSON with these exact keys:

{
  "name": "Full name of the candidate",
  "email": "Email address (or null if not found)",
  "phone": "Phone number (or null if not found)",
  "skills": ["list", "of", "skills"],
  "work_experience": [
    {
      "company": "Company name",
      "role": "Job title",
      "duration": "Start - End",
      "highlights": ["Key achievement or responsibility"]
    }
  ],
  "education": [
    {
      "institution": "University/School name",
      "degree": "Degree and field of study",
      "year": "Graduation year or date range"
    }
  ],
  "recruiter_summary": "A 2-sentence summary for a recruiter highlighting the candidate's strongest qualifications and fit."
}

Return ONLY valid JSON. Extract as much information as possible from the text. If a field cannot be determined, use null for strings or empty arrays for lists."""


ANALYSIS_SYSTEM_PROMPT = """You are a professional resume analyst. Given structured parsed resume data and the raw resume text, evaluate the resume quality and return a JSON analysis object.

Return ONLY valid JSON matching this exact schema:

{
  "score": {
    "breakdown": {
      "contact_info":  { "score": <int>, "max": 20, "note": "<string>" },
      "skills":        { "score": <int>, "max": 25, "note": "<string>" },
      "experience":    { "score": <int>, "max": 30, "note": "<string>" },
      "education":     { "score": <int>, "max": 15, "note": "<string>" },
      "formatting":    { "score": <int>, "max": 10, "note": "<string>" }
    }
  },
  "ats": {
    "score": <int 0-100>,
    "issues": ["<string>", ...]
  },
  "career_level": "<entry|mid|senior>",
  "career_level_advice": "<string>",
  "improvements": [
    { "id": "i1", "priority": "high|medium|low", "text": "<string>" },
    ...
  ],
  "rewrites": [
    { "section": "<string>", "original": "<string>", "suggested": "<string>" },
    ...
  ]
}

SCORING HARD LIMITS: contact_info MAX is 20, skills MAX is 25, experience MAX is 30, education MAX is 15, formatting MAX is 10. These are hard limits — never return a score value above its category max.

Do NOT include a "total" field anywhere inside "score" — the total is computed server-side.

For "improvements": return 5–8 items ordered by priority (high → medium → low). Each item must have a unique id (i1, i2, ...), a priority of "high", "medium", or "low", and a specific, actionable text recommendation.

For "rewrites": return 2–3 rewrite suggestions targeting the weakest sections. Each item must have a "section" name, the "original" text snippet from the resume, and a "suggested" improved version.

Return ONLY valid JSON. No additional commentary or explanation."""


def analyze_resume_with_llm(text, api_key):
    """Send extracted text to OpenAI gpt-4o-mini for structured resume analysis."""
    client = OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Parse the following resume text:\n\n{text}"},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,
        max_tokens=2000,
    )

    result = json.loads(response.choices[0].message.content)
    logger.info("LLM analysis completed successfully")
    return result


def analyze_resume_deep(parsed_data, raw_text, api_key):
    """Send parsed resume data and raw text to OpenAI gpt-4o-mini for deep quality analysis."""
    client = OpenAI(api_key=api_key)

    user_message = (
        f"Parsed resume data:\n{json.dumps(parsed_data)}\n\n"
        f"Raw resume text:\n{raw_text[:6000]}"
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=2500,
    )

    result = json.loads(response.choices[0].message.content)

    # Compute total server-side — never trust the LLM to sum correctly
    result["score"]["total"] = int(sum(v["score"] for v in result["score"]["breakdown"].values()))

    logger.info("Deep resume analysis completed successfully")
    return result


def store_results(document_id, filename, status, session_id="", parsed_data=None, extracted_text="", error_message=None, analysis=None):
    """Store processing results in DynamoDB."""
    item = {
        "document_id": document_id,
        "filename": filename,
        "upload_timestamp": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "extracted_text_preview": extracted_text[:500] if extracted_text else "",
    }

    if session_id:
        item["session_id"] = session_id

    if parsed_data:
        # Convert any floats to Decimal for DynamoDB compatibility
        item["parsed_data"] = json.loads(json.dumps(parsed_data), parse_float=Decimal)

    if error_message:
        item["error_message"] = error_message

    if analysis:
        item["analysis"] = json.loads(json.dumps(analysis), parse_float=Decimal)

    table.put_item(Item=item)
    logger.info("Results stored in DynamoDB: document_id=%s, status=%s", document_id, status)


def lambda_handler(event, context):
    """Main handler triggered by S3 PUT event."""
    logger.info("Event received: %s", json.dumps(event))

    try:
        # Extract S3 event details
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        filename = key.split("/")[-1]

        # Validate file extension
        if not key.lower().endswith(".pdf"):
            logger.warning("Skipping non-PDF file: %s", key)
            return {"statusCode": 200, "body": "Skipped non-PDF file"}

        # Extract session_id from key path: uploads/{session_id}/{file_id}.pdf
        key_parts = key.split("/")
        session_id = key_parts[1] if len(key_parts) >= 3 else ""
        logger.info("Session ID: %s", session_id)

        # Generate document ID from S3 key
        document_id = hashlib.sha256(f"{bucket}/{key}".encode()).hexdigest()[:16]
        logger.info("Processing document: %s (id: %s)", filename, document_id)

        # Store initial processing status
        store_results(document_id, filename, "PROCESSING", session_id=session_id)

        # Download PDF from S3
        response = s3_client.get_object(Bucket=bucket, Key=key)
        pdf_bytes = response["Body"].read()
        logger.info("Downloaded PDF from S3: %d bytes", len(pdf_bytes))

        # Extract text
        extracted_text = extract_text_from_pdf(pdf_bytes)
        if not extracted_text.strip():
            store_results(document_id, filename, "FAILED", session_id=session_id,
                         error_message="Could not extract text from PDF. The file may be scanned/image-based.")
            return {"statusCode": 200, "body": "No text extracted"}

        # Analyze with LLM
        api_key = get_openai_api_key()
        parsed_data = analyze_resume_with_llm(extracted_text, api_key)

        # Store successful results
        store_results(document_id, filename, "COMPLETED", session_id=session_id,
                     parsed_data=parsed_data, extracted_text=extracted_text)

        logger.info("Document processing completed successfully: %s", document_id)
        return {"statusCode": 200, "body": json.dumps({"document_id": document_id, "status": "COMPLETED"})}

    except Exception as e:
        logger.error("Unhandled error processing document: %s", str(e), exc_info=True)

        # Attempt to store failure status
        try:
            if "document_id" in dir() and "filename" in dir():
                store_results(document_id, filename, "FAILED", session_id=session_id if "session_id" in dir() else "", error_message=str(e))
        except Exception:
            logger.error("Failed to store error status in DynamoDB", exc_info=True)

        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
