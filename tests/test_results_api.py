"""
Tests for lambda/results_api/lambda_function.py

Covers:
- job_match() endpoint (Tasks 5 & 6)
- Routing restructure (Task 7)
- list_documents() excludes 'analysis' field (Task 7)

Setup notes:
- env vars must be set before importing the module (module-level boto3/DynamoDB init)
- boto3 clients are mocked around the import so module-level init doesn't fail
- openai is mocked in sys.modules before import so it can be loaded without the real package
"""

import importlib
import json
import os
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

# --- Add the Lambda source directory to sys.path ---
_LAMBDA_DIR = str(Path(__file__).resolve().parent.parent / "lambda" / "results_api")
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

# --- Set required env vars BEFORE importing the module ---
os.environ.setdefault("DYNAMODB_TABLE", "test-results-table")
os.environ.setdefault("S3_BUCKET", "test-bucket")
os.environ.setdefault("SSM_PARAMETER_NAME", "/test/openai-api-key")

# --- Mock openai so the import doesn't require the real package ---
openai_mock = types.ModuleType("openai")
openai_mock.OpenAI = MagicMock()
sys.modules.setdefault("openai", openai_mock)

# --- Mock boto3 clients so the module-level DynamoDB Table init doesn't fail ---
with patch("boto3.client"), patch("boto3.resource") as mock_resource:
    mock_table = MagicMock()
    mock_resource.return_value.Table.return_value = mock_table

    # Use a unique module name to avoid collisions with document_processor's lambda_function
    import importlib.util
    _spec = importlib.util.spec_from_file_location(
        "results_api_lambda",
        Path(_LAMBDA_DIR) / "lambda_function.py",
    )
    results_api = importlib.util.module_from_spec(_spec)
    sys.modules["results_api_lambda"] = results_api
    _spec.loader.exec_module(results_api)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_job_match_event(doc_id, body):
    """Build a Lambda proxy event for POST /documents/{doc_id}/job-match."""
    return {
        "httpMethod": "POST",
        "path": f"/documents/{doc_id}/job-match",
        "pathParameters": {"id": doc_id},
        "queryStringParameters": {},
        "body": json.dumps(body),
    }


def make_list_event(session_id):
    """Build a Lambda proxy event for GET /documents."""
    return {
        "httpMethod": "GET",
        "path": "/documents",
        "pathParameters": {},
        "queryStringParameters": {"session_id": session_id} if session_id else {},
        "body": None,
    }


def make_mock_openai_response(content_dict):
    """Return a mock that mirrors the shape of an OpenAI ChatCompletion response."""
    mock_message = MagicMock()
    mock_message.content = json.dumps(content_dict)

    mock_choice = MagicMock()
    mock_choice.message = mock_message

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    return mock_response


# ---------------------------------------------------------------------------
# Tests: job_match()
# ---------------------------------------------------------------------------

class TestJobMatch:

    def setup_method(self):
        """Reset module-level cache between tests."""
        results_api._openai_api_key = None
        mock_table.reset_mock()

    def test_job_match_returns_404_for_missing_document(self):
        """job_match returns 404 when the document does not exist in DynamoDB."""
        mock_table.get_item.return_value = {}  # no 'Item' key

        event = make_job_match_event("nonexistent-doc", {"job_description": "Some job"})
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 404
        body = json.loads(resp["body"])
        assert "error" in body

    def test_job_match_returns_400_for_missing_parsed_data(self):
        """job_match returns 400 when the document exists but has no parsed_data."""
        mock_table.get_item.return_value = {
            "Item": {"document_id": "doc-123", "status": "PROCESSING"}
            # no parsed_data
        }

        event = make_job_match_event("doc-123", {"job_description": "Some job"})
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "not yet" in body["error"].lower() or "processed" in body["error"].lower()

    def test_job_match_returns_400_for_empty_job_description(self):
        """job_match returns 400 when job_description is empty."""
        event = make_job_match_event("doc-123", {"job_description": ""})
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "required" in body["error"].lower()

    def test_job_match_returns_400_for_oversized_job_description(self):
        """job_match returns 400 when job_description exceeds 5000 characters."""
        event = make_job_match_event("doc-123", {"job_description": "x" * 5001})
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 400
        body = json.loads(resp["body"])
        assert "5000" in body["error"]

    def test_job_match_returns_200_with_match_result(self):
        """job_match returns 200 with match_score, strong_matches, missing_keywords,
        tailoring_tips when document exists and OpenAI call succeeds."""
        mock_table.get_item.return_value = {
            "Item": {
                "document_id": "doc-456",
                "status": "COMPLETED",
                "parsed_data": {
                    "name": "Jane Doe",
                    "skills": ["Python", "AWS"],
                },
            }
        }

        match_response = {
            "match_score": 78,
            "strong_matches": ["Python", "AWS"],
            "missing_keywords": ["Kubernetes", "Terraform"],
            "tailoring_tips": [
                "Add Kubernetes experience",
                "Highlight cloud infrastructure work",
            ],
        }

        mock_openai_response = make_mock_openai_response(match_response)
        mock_openai_instance = MagicMock()
        mock_openai_instance.chat.completions.create.return_value = mock_openai_response

        with patch.object(results_api, "get_openai_api_key", return_value="sk-test"), \
             patch.object(results_api, "OpenAI", return_value=mock_openai_instance):

            event = make_job_match_event("doc-456", {"job_description": "Python developer with AWS and Kubernetes"})
            resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert "match_score" in body
        assert "strong_matches" in body
        assert "missing_keywords" in body
        assert "tailoring_tips" in body
        assert body["match_score"] == 78


# ---------------------------------------------------------------------------
# Tests: list_documents() — analysis field exclusion
# ---------------------------------------------------------------------------

class TestListDocuments:

    def setup_method(self):
        mock_table.reset_mock()

    def test_list_documents_excludes_analysis_field(self):
        """list_documents must not include the 'analysis' field in the summary response."""
        mock_table.query.return_value = {
            "Items": [
                {
                    "document_id": "doc-789",
                    "filename": "resume.pdf",
                    "upload_timestamp": "2026-04-01T10:00:00Z",
                    "status": "COMPLETED",
                    "parsed_data": {"name": "John Smith"},
                    "analysis": {
                        "score": {"total": 85},
                        "ats": {"score": 80, "issues": []},
                    },
                }
            ]
        }

        event = make_list_event("session-abc")
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert len(body["documents"]) == 1
        doc = body["documents"][0]
        assert "analysis" not in doc
        assert "parsed_data" not in doc
        assert doc["document_id"] == "doc-789"


# ---------------------------------------------------------------------------
# Tests: routing
# ---------------------------------------------------------------------------

class TestRouting:

    def setup_method(self):
        mock_table.reset_mock()

    def test_post_unknown_path_returns_404(self):
        """POST to an unknown path returns 404."""
        event = {
            "httpMethod": "POST",
            "path": "/unknown",
            "pathParameters": {},
            "queryStringParameters": {},
            "body": json.dumps({}),
        }
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 404

    def test_unsupported_method_returns_405(self):
        """DELETE (or any unsupported method) returns 405."""
        event = {
            "httpMethod": "DELETE",
            "path": "/documents/some-id",
            "pathParameters": {"id": "some-id"},
            "queryStringParameters": {},
            "body": None,
        }
        resp = results_api.lambda_handler(event, None)

        assert resp["statusCode"] == 405
