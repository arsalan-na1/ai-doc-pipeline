"""
Tests for analyze_resume_deep() in lambda_function.py.

These tests are intentionally written BEFORE the function exists (TDD).
They will fail with AttributeError until analyze_resume_deep() is implemented.

Setup notes:
- env vars must be set before importing lambda_function (module-level boto3/DynamoDB init)
- fitz and pdfplumber are binary Lambda layer deps unavailable locally; mock them in
  sys.modules before the import so the module can be loaded at all
"""

import json
import os
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

# --- Add the Lambda source directory to sys.path so lambda_function is importable ---
_LAMBDA_DIR = str(Path(__file__).resolve().parent.parent / "lambda" / "document_processor")
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

# --- Set required env vars BEFORE importing lambda_function ---
os.environ.setdefault("DYNAMODB_TABLE", "test-table")
os.environ.setdefault("SSM_PARAMETER_NAME", "/test/openai-api-key")

# --- Mock binary deps that are only available in the Lambda layer ---
# fitz (PyMuPDF) and pdfplumber ship as compiled C extensions in the layer;
# they are not installed locally, so stub them out before the import.
fitz_mock = types.ModuleType("fitz")
fitz_mock.open = MagicMock()
sys.modules.setdefault("fitz", fitz_mock)

pdfplumber_mock = types.ModuleType("pdfplumber")
pdfplumber_mock.open = MagicMock()
sys.modules.setdefault("pdfplumber", pdfplumber_mock)

# --- Mock boto3 clients so the module-level DynamoDB Table init doesn't fail ---
with patch("boto3.client"), patch("boto3.resource") as mock_resource:
    mock_table = MagicMock()
    mock_resource.return_value.Table.return_value = mock_table
    import lambda_function  # noqa: E402  (must come after env + sys.modules setup)


# ---------------------------------------------------------------------------
# Helpers & fixtures
# ---------------------------------------------------------------------------

def make_mock_openai_response(content_dict):
    """Return a mock that mirrors the shape of an OpenAI ChatCompletion response.

    Specifically: response.choices[0].message.content == json.dumps(content_dict)
    """
    mock_message = MagicMock()
    mock_message.content = json.dumps(content_dict)

    mock_choice = MagicMock()
    mock_choice.message = mock_message

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    return mock_response


# SAMPLE_ANALYSIS_RESPONSE matches the spec's analysis JSON schema.
# Note: there is NO "total" key inside "score" — that is computed server-side
# by analyze_resume_deep(), which is what the tests verify.
SAMPLE_ANALYSIS_RESPONSE = {
    "score": {
        "breakdown": {
            "contact_info": {"score": 18, "max": 20, "note": "Missing LinkedIn URL"},
            "skills":        {"score": 22, "max": 25, "note": "Strong breadth, lacks depth labels"},
            "experience":    {"score": 24, "max": 30, "note": "No quantified achievements"},
            "education":     {"score": 12, "max": 15, "note": "Degree present, GPA absent"},
            "formatting":    {"score":  6, "max": 10, "note": "Dense paragraphs, no bullet points"},
        }
        # total intentionally absent — analyze_resume_deep() must add it
    },
    "ats": {
        "score": 71,
        "issues": [
            "No standard section headers",
            "Phone number format may not parse in older ATS",
            "Skills buried in prose",
        ],
    },
    "career_level": "mid",
    "career_level_advice": "Mid-level recruiters expect quantified impact.",
    "improvements": [
        {"id": "i1", "priority": "high", "text": "Add metrics to your Amazon role"},
        {"id": "i2", "priority": "high", "text": "Create a dedicated Skills section"},
    ],
    "rewrites": [
        {
            "section": "Experience — Amazon",
            "original": "Worked on the backend team",
            "suggested": "Led backend optimization initiative reducing API latency by 40%",
        }
    ],
}

SAMPLE_PARSED_DATA = {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "555-1234",
    "skills": ["Python", "Go"],
    "work_experience": [],
    "education": [],
    "recruiter_summary": "Strong engineer with 5 years of Python experience.",
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestStoreResults:
    """Tests for store_results() — specifically the analysis field handling."""

    def test_store_results_saves_analysis_field(self):
        """store_results() must persist the analysis dict as item['analysis'],
        with float values converted to Decimal."""
        from decimal import Decimal

        analysis = {
            "score": {
                "breakdown": {
                    "contact_info": {"score": 18, "max": 20, "note": "Good"},
                },
                "total": 18,
            },
            "ats": {"score": 71.5, "issues": []},
            "career_level": "mid",
            "career_level_advice": "Add metrics.",
            "improvements": [],
            "rewrites": [],
        }

        mock_table.reset_mock()
        lambda_function.store_results(
            document_id="doc123",
            filename="resume.pdf",
            status="COMPLETED",
            analysis=analysis,
        )

        assert mock_table.put_item.called
        stored_item = mock_table.put_item.call_args[1]["Item"]
        assert "analysis" in stored_item
        # Float 71.5 must be converted to Decimal
        assert stored_item["analysis"]["ats"]["score"] == Decimal("71.5")

    def test_store_results_without_analysis_omits_field(self):
        """store_results() called without analysis arg must not include 'analysis' key."""
        mock_table.reset_mock()
        lambda_function.store_results(
            document_id="doc456",
            filename="resume.pdf",
            status="COMPLETED",
        )

        assert mock_table.put_item.called
        stored_item = mock_table.put_item.call_args[1]["Item"]
        assert "analysis" not in stored_item


class TestAnalyzeResumeDeep:
    """Tests for the (not-yet-implemented) analyze_resume_deep() function."""

    def test_analyze_resume_deep_computes_total_server_side(self):
        """analyze_resume_deep() must sum the 5 category scores and store the result
        as result["score"]["total"]. The value must be an int equal to 82."""
        mock_response = make_mock_openai_response(SAMPLE_ANALYSIS_RESPONSE)

        with patch("lambda_function.OpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_openai_cls.return_value = mock_client

            result = lambda_function.analyze_resume_deep(
                parsed_data=SAMPLE_PARSED_DATA,
                raw_text="Sample resume text.",
                api_key="sk-test-key",
            )

        assert result["score"]["total"] == 82
        assert isinstance(result["score"]["total"], int)

    def test_analyze_resume_deep_preserves_all_fields(self):
        """analyze_resume_deep() must return all 6 top-level keys from the LLM response
        (score, ats, career_level, career_level_advice, improvements, rewrites)."""
        mock_response = make_mock_openai_response(SAMPLE_ANALYSIS_RESPONSE)

        with patch("lambda_function.OpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_openai_cls.return_value = mock_client

            result = lambda_function.analyze_resume_deep(
                parsed_data=SAMPLE_PARSED_DATA,
                raw_text="Sample resume text.",
                api_key="sk-test-key",
            )

        expected_keys = {"score", "ats", "career_level", "career_level_advice", "improvements", "rewrites"}
        assert expected_keys.issubset(result.keys()), (
            f"Missing keys: {expected_keys - result.keys()}"
        )

    def test_analyze_resume_deep_truncates_raw_text_to_6000(self):
        """analyze_resume_deep() must truncate raw_text to 6000 chars before including
        it in the USER message sent to OpenAI (not the system prompt)."""
        long_text = "A" * 10_000  # 10,000-char string — well over the 6,000-char limit
        mock_response = make_mock_openai_response(SAMPLE_ANALYSIS_RESPONSE)

        with patch("lambda_function.OpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = mock_response
            mock_openai_cls.return_value = mock_client

            lambda_function.analyze_resume_deep(
                parsed_data=SAMPLE_PARSED_DATA,
                raw_text=long_text,
                api_key="sk-test-key",
            )

        # Inspect the messages passed to chat.completions.create
        call_kwargs = mock_client.chat.completions.create.call_args
        messages = (
            call_kwargs.kwargs.get("messages")
            or (call_kwargs.args[0] if call_kwargs.args else call_kwargs.kwargs["messages"])
        )

        # Find the user message(s)
        user_messages = [m for m in messages if m.get("role") == "user"]
        assert user_messages, "No user message found in OpenAI call"

        user_content = user_messages[0]["content"]
        # The full 10,000-char string must NOT appear in the user message
        assert "A" * 10_000 not in user_content, (
            "User message contains the full 10,000-char text (not truncated)"
        )
        # The user message must contain at most 6,000 chars of the raw text
        a_count = user_content.count("A")
        assert a_count <= 6000, (
            f"User message contains {a_count} 'A' chars; expected at most 6000"
        )


# ---------------------------------------------------------------------------
# S3 event fixture shared by lambda_handler tests
# ---------------------------------------------------------------------------

SAMPLE_S3_EVENT = {
    "Records": [{
        "s3": {
            "bucket": {"name": "test-bucket"},
            "object": {"key": "uploads/test-session/test-file.pdf"}
        }
    }]
}


class TestLambdaHandler:
    """Tests for lambda_handler() — deep-analysis wiring."""

    def test_lambda_handler_passes_analysis_to_store_results(self):
        """lambda_handler must call store_results with analysis=<analysis_dict>
        when analyze_resume_deep succeeds."""
        analysis_result = {
            "score": {"breakdown": {}, "total": 80},
            "ats": {"score": 75, "issues": []},
            "career_level": "mid",
            "career_level_advice": "Good job.",
            "improvements": [],
            "rewrites": [],
        }

        fake_pdf_bytes = b"%PDF-1.4 fake"
        fake_s3_response = {"Body": MagicMock(read=MagicMock(return_value=fake_pdf_bytes))}

        with patch("lambda_function.s3_client") as mock_s3, \
             patch("lambda_function.extract_text_from_pdf", return_value="resume text"), \
             patch("lambda_function.analyze_resume_with_llm", return_value=SAMPLE_PARSED_DATA), \
             patch("lambda_function.analyze_resume_deep", return_value=analysis_result), \
             patch("lambda_function.store_results") as mock_store, \
             patch("lambda_function.get_openai_api_key", return_value="sk-test"):

            mock_s3.get_object.return_value = fake_s3_response

            lambda_function.lambda_handler(SAMPLE_S3_EVENT, None)

        # Find the COMPLETED store_results call
        completed_call = None
        for call in mock_store.call_args_list:
            args, kwargs = call
            status = args[2] if len(args) > 2 else kwargs.get("status", "")
            if status == "COMPLETED":
                completed_call = call
                break

        assert completed_call is not None, "store_results was never called with COMPLETED status"
        _, kwargs = completed_call
        assert "analysis" in kwargs, "store_results was not called with analysis= kwarg"
        assert kwargs["analysis"] == analysis_result

    def test_lambda_handler_completes_without_analysis_when_deep_fails(self):
        """lambda_handler must call store_results with analysis=None and return
        statusCode 200 when analyze_resume_deep raises an exception."""
        fake_pdf_bytes = b"%PDF-1.4 fake"
        fake_s3_response = {"Body": MagicMock(read=MagicMock(return_value=fake_pdf_bytes))}

        with patch("lambda_function.s3_client") as mock_s3, \
             patch("lambda_function.extract_text_from_pdf", return_value="resume text"), \
             patch("lambda_function.analyze_resume_with_llm", return_value=SAMPLE_PARSED_DATA), \
             patch("lambda_function.analyze_resume_deep", side_effect=Exception("LLM timeout")), \
             patch("lambda_function.store_results") as mock_store, \
             patch("lambda_function.get_openai_api_key", return_value="sk-test"):

            mock_s3.get_object.return_value = fake_s3_response

            result = lambda_function.lambda_handler(SAMPLE_S3_EVENT, None)

        assert result["statusCode"] == 200

        # Find the COMPLETED store_results call
        completed_call = None
        for call in mock_store.call_args_list:
            args, kwargs = call
            status = args[2] if len(args) > 2 else kwargs.get("status", "")
            if status == "COMPLETED":
                completed_call = call
                break

        assert completed_call is not None, "store_results was never called with COMPLETED status"
        _, kwargs = completed_call
        assert kwargs.get("analysis") is None
