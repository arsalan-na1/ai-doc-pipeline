# Resume Intelligence Features — Design Spec
**Date:** 2026-03-25
**Status:** Approved

## Overview

Add six resume intelligence features to the AI Document Intelligence Pipeline: Resume Score, Improvement Suggestions, ATS Compatibility Check, Job Match, Career Level Detection, and one-click Rewrite Suggestions. All features stay on AWS Free Tier. OpenAI costs remain minimal (one extra gpt-4o-mini call per upload).

## Approach

**Two targeted GPT calls at upload time + one new on-demand endpoint.**

- GPT call #1 (existing, unchanged): parse resume → `parsed_data`
- GPT call #2 (new): analyze resume → `analysis`
- New endpoint: `POST /documents/{id}/job-match` → on-demand match against a user-supplied job description

No new Lambdas. No new DynamoDB tables. One new API Gateway method on an existing resource.

## Data Model

### `analysis` field (stored on DynamoDB item at upload time)

```json
{
  "score": {
    "total": 82,
    "breakdown": {
      "contact_info":  { "score": 18, "max": 20, "note": "Missing LinkedIn URL" },
      "skills":        { "score": 22, "max": 25, "note": "Strong breadth, lacks depth labels" },
      "experience":    { "score": 24, "max": 30, "note": "No quantified achievements" },
      "education":     { "score": 12, "max": 15, "note": "Degree present, GPA absent" },
      "formatting":    { "score":  6, "max": 10, "note": "Dense paragraphs, no bullet points" }
    }
  },
  "ats": {
    "score": 71,
    "issues": [
      "No standard section headers (EXPERIENCE, EDUCATION, SKILLS)",
      "Phone number format may not parse in older ATS",
      "Skills buried in prose — ATS expects a dedicated Skills section"
    ]
  },
  "career_level": "mid",
  "career_level_advice": "Mid-level recruiters expect quantified impact. Add metrics to every major role.",
  "improvements": [
    { "id": "i1", "priority": "high",   "text": "Add metrics to your Amazon role — e.g. 'reduced latency by 40%'" },
    { "id": "i2", "priority": "high",   "text": "Create a dedicated Skills section with keywords" },
    { "id": "i3", "priority": "medium", "text": "Add LinkedIn profile URL to contact section" },
    { "id": "i4", "priority": "medium", "text": "Replace dense paragraphs with bullet points" },
    { "id": "i5", "priority": "low",    "text": "Add a one-line professional summary at the top" }
  ],
  "rewrites": [
    {
      "section": "Experience — Amazon",
      "original": "Worked on the backend team improving system performance",
      "suggested": "Led backend optimization initiative reducing API latency by 40% across 2M+ daily requests"
    },
    {
      "section": "Skills section",
      "original": "(missing — skills mentioned inline in job descriptions)",
      "suggested": "Python · AWS · DynamoDB · REST APIs · Distributed Systems · Git · CI/CD"
    }
  ]
}
```

**Score constraint:** The five category maxes are fixed at 20/25/30/15/10 (sum = 100). The `ANALYSIS_SYSTEM_PROMPT` must state these verbatim as hard limits: *"contact_info MAX is 20, skills MAX is 25, experience MAX is 30, education MAX is 15, formatting MAX is 10. These are hard limits — never return a score value above its category max."* GPT never sets `total` directly — it is computed server-side as `int(sum(v["score"] for v in breakdown.values()))`, which also eliminates float drift.

**`improvements`** is ordered high → medium → low priority. 5–8 items.

**`rewrites`** covers the 2–3 weakest sections only.

### Job Match — request / response

`POST /documents/{id}/job-match`

Request body:
```json
{ "job_description": "We're looking for a Senior Engineer with 5+ years..." }
```

`job_description` must be non-empty and must not exceed 5,000 characters. The API returns 400 if either condition is violated.

Response:
```json
{
  "match_score": 74,
  "strong_matches": ["Python", "AWS", "DynamoDB"],
  "missing_keywords": ["Kubernetes", "Terraform", "CI/CD pipelines"],
  "tailoring_tips": [
    "Add 'Kubernetes' to your skills — it appears 4× in the JD",
    "Reframe your DevOps experience to explicitly mention 'CI/CD pipelines'",
    "The JD emphasizes team leadership — add a line about mentoring or leading projects"
  ]
}
```

The job-match prompt uses `parsed_data` (structured skills, experience, education JSON already on the DynamoDB item) as the resume context — not raw text. Because `parsed_data` is fetched from DynamoDB it will contain `Decimal` values; serialize it using `json.dumps(parsed_data, cls=DecimalEncoder)` before injecting into the prompt.

### `JOB_MATCH_SYSTEM_PROMPT` requirements

The prompt must instruct GPT to return a JSON object with exactly these fields: `match_score` (integer 0–100), `strong_matches` (array of strings), `missing_keywords` (array of strings), `tailoring_tips` (array of 2–4 actionable strings). State the field names and types as hard requirements — GPT must not rename or add fields.

## Infrastructure Changes

### API Gateway

Create a new child resource `/documents/{id}/job-match` under the existing `/documents/{id}` resource. Add a `POST` method on this new resource with Lambda proxy integration pointing to `results_api`. Also add an `OPTIONS` method on `/documents/{id}/job-match` — the Lambda's existing `OPTIONS` handler will return the updated `CORS_HEADERS` including `POST`.

**Note on OPTIONS handling:** The existing setup passes OPTIONS requests through to the Lambda (which handles them in the `if http_method == "OPTIONS"` branch). Updating `CORS_HEADERS` in the Lambda is sufficient — no mock integration change needed.

**Note on routing:** Because a child resource is used, `event["path"]` in the Lambda will be `/documents/abc123/job-match`. The routing condition `path.endswith("/job-match")` is therefore correct and unambiguous.

### IAM

Grant the `results_api` Lambda execution role `ssm:GetParameter` permission on the OpenAI API key parameter ARN. The `document_processor` role already has this — `results_api` currently does not.

## Backend Changes

### `lambda/document_processor/lambda_function.py`

**Add `ANALYSIS_SYSTEM_PROMPT`**

A focused prompt that receives `parsed_data` JSON and raw resume text (truncated to 6,000 chars to stay comfortably within gpt-4o-mini's context window alongside the output budget). The prompt must include the hard score-max language verbatim (see Data Model above). Returns the `analysis` JSON object as specified.

**Add `analyze_resume_deep(parsed_data, raw_text, api_key)`**

Same pattern as `analyze_resume_with_llm`:
- Creates `OpenAI(api_key=api_key)` client
- Passes `parsed_data` as JSON using plain `json.dumps(parsed_data)` (no `DecimalEncoder` needed — at this point `parsed_data` is still a raw Python dict from GPT, not yet stored in DynamoDB, so no Decimals are present) and `raw_text[:6000]` in the user message
- Calls `gpt-4o-mini` with `response_format={"type": "json_object"}`
- Temperature `0.2`, `max_tokens=2500`
- After parsing response, computes total server-side: `result["score"]["total"] = int(sum(v["score"] for v in result["score"]["breakdown"].values()))`
- Returns the dict

**Update `lambda_handler`**

After `parsed_data = analyze_resume_with_llm(...)` succeeds, call `analyze_resume_deep()` in a `try/except`. The existing `store_results` call (line 201–202) gains one additional keyword argument — `analysis=analysis_data` — while all other arguments (`session_id`, `parsed_data`, `extracted_text`) are retained unchanged. On analysis failure, log and call `store_results` without the `analysis` argument — document stores as COMPLETED with `parsed_data` intact.

**Update `store_results`**

Add optional `analysis` parameter. If provided, store as `item["analysis"]` using the same `json.loads(json.dumps(...), parse_float=Decimal)` conversion as `parsed_data`.

### `lambda/results_api/lambda_function.py`

**New import:** Add `from openai import OpenAI` at the top of the file (alongside the existing `boto3` import). The `openai` package is already a dependency of the Lambda layer used by `document_processor`; confirm it is available in `results_api`'s layer or add it.

**New env var:** `SSM_PARAMETER_NAME` — same SSM parameter as document_processor.

**Add `get_openai_api_key()`** — identical SSM caching pattern (module-level `_openai_api_key = None`).

**Update `CORS_HEADERS`** — add `POST` to `Access-Control-Allow-Methods`.

**Restructure `lambda_handler` method routing**

Replace the current flat `if GET ... else: 405` with explicit branches:
```python
if http_method == "OPTIONS":
    return response(200, {})
elif http_method == "GET":
    # existing GET routing unchanged
elif http_method == "POST":
    body = json.loads(event.get("body") or "{}")
    if path.startswith("/documents/") and path_params.get("id") and path.endswith("/job-match"):
        jd = body.get("job_description", "").strip()
        if not jd:
            return response(400, {"error": "job_description is required"})
        if len(jd) > 5000:
            return response(400, {"error": "job_description exceeds 5000 character limit"})
        return job_match(path_params["id"], jd)
    return response(404, {"error": "Not found"})
else:
    return response(405, {"error": "Method not allowed"})
```

**Add `job_match(document_id, job_description)`**
1. Fetch item from DynamoDB by `document_id`; return 404 if not found
2. Return 400 `"Document not yet processed"` if `parsed_data` absent
3. Serialize: `resume_context = json.dumps(item["parsed_data"], cls=DecimalEncoder)`
4. Call `gpt-4o-mini` with `JOB_MATCH_SYSTEM_PROMPT`, temperature 0.3, max_tokens 1000, `response_format={"type": "json_object"}`
5. Return `response(200, json.loads(result_content))`

**Update `list_documents`**

Explicitly exclude `analysis` from the per-document summary dict (same as `parsed_data` is currently excluded). This prevents the large analysis blob from inflating list response payloads.

## Frontend Changes (`frontend/index.html`)

### Hash-based routing

```javascript
function renderPage() {
  const hash = location.hash;
  if (hash.startsWith('#doc/')) {
    const id = hash.slice(5);
    showAnalysisPage(id);   // fetches GET /documents/{id} immediately
  } else {
    showHomePage();
  }
}
window.addEventListener('hashchange', renderPage);
renderPage(); // fires on load — direct-link to #doc/abc123 populates fully without interaction
```

`showAnalysisPage(id)` fetches `GET /documents/{id}` immediately on call (no interaction required), shows a loading state while in-flight, then calls `renderAnalysisPage(doc)` on success.

`showHomePage()` / `showAnalysisPage()` toggle visibility of `#main-content` and `#doc-page` divs. The `#doc-page` div is a full-viewport overlay (`position: fixed; inset: 0; z-index: 50; overflow-y: auto`).

**`openModal(id)` is removed** from the doc-detail flow. Doc card `onclick` changes to `location.hash = '#doc/' + id`. The How It Works modal (`#hiw-modal`) is kept unchanged.

### Analysis page layout (`#doc-page`)

```
← Back              [Candidate Name]              Match to Job ↗
────────────────────────────────────────────────────────────────
  [Score ring: 82]   ATS: 71%   Career Level: Mid-Level
  Category bars: Contact(18/20) Skills(22/25) Exp(24/30) Edu(12/15) Format(6/10)
────────────────────────────────────────────────────────────────
  ATS Issues          (⚠ flagged items list)
────────────────────────────────────────────────────────────────
  Improvements        (checkable cards, high → medium → low)
────────────────────────────────────────────────────────────────
  Rewrite Suggestions (expandable: original → suggested + Copy btn)
────────────────────────────────────────────────────────────────
  Resume Details      (name, contact, skills, experience, education — same as current modal)
```

If `doc.analysis` is absent (old document or analysis call failed), the score/ATS/improvements/rewrites sections are hidden. Resume details still show.

### Improvement cards

- Checkbox on left, priority badge (`HIGH` / `MED` / `LOW`) on right
- Checking strikes through text and dims the card
- State stored in a JS `Set` of checked IDs (`checkedIds`)
- **`checkedIds` is re-initialized to `new Set()` inside `showAnalysisPage()` on every call** — not just on page load — so hash navigation between documents never carries stale checkmarks

### Rewrite suggestion cards

- Collapsed by default showing section name + expand chevron
- Expanded: original text (dim, faint strikethrough style) above suggested rewrite (bright)
- "Copy" button uses `navigator.clipboard.writeText()` — requires HTTPS (works on CloudFront; test locally with `python -m http.server`, not by opening the file directly from disk)

### Job Match drawer

- Triggered by "Match to Job" button in analysis page header
- Slides in from the right at ~480px wide, same glassmorphism style as other surfaces
- Contains: textarea for JD (placeholder: "Paste job description here…"), "Analyze Match" button
- On click: button shows spinner, calls `POST /documents/{id}/job-match`
- Results render below: match score ring, strong-matches chips (green), missing-keywords chips (red/orange), tailoring tips list
- Closed by X button or clicking the semi-transparent backdrop
- Drawer state is independent of hash — opening/closing it does not change the URL

## Error Handling

| Scenario | Behavior |
|---|---|
| Analysis GPT call fails at upload | Document stores as COMPLETED with `parsed_data` only; analysis panel hidden in UI |
| Job-match call fails | Error message shown inline in drawer; drawer stays open |
| `GET /documents/{id}` returns 404 on direct-link | Analysis page shows "Document not found" with a back link |
| `job_description` missing or empty | API returns 400 with clear error message |
| `job_description` exceeds 5,000 chars | API returns 400 with clear error message |
| `parsed_data` absent (doc still PROCESSING) | Job-match returns 400: "Document not yet processed" |
| results_api SSM call fails (IAM misconfigured) | Job-match returns 500; document processor is unaffected |

## Security Notes

Document IDs are 16-char hex tokens (SHA-256 truncated). `GET /documents/{id}` does not validate `session_id` — direct-link access is intentionally unauthenticated. This is an existing tradeoff, not new behaviour introduced by this feature. Implementers must not add session_id validation to `get_document`.

## Out of Scope

- Persisting improvement card checkoffs to DynamoDB
- Re-analyzing documents uploaded before this feature ships
- Job match history / saving past job descriptions
- Batch analysis of existing documents
