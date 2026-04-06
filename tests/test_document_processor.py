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
