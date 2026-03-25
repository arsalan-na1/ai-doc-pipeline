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

No new AWS resources. No new Lambdas. No new DynamoDB tables.

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

**Score constraint:** The five category maxes are fixed at 20/25/30/15/10 (sum = 100). The `ANALYSIS_SYSTEM_PROMPT` explicitly states these as hard limits GPT must not exceed. `total` is computed server-side by summing the five `score` values — GPT never sets `total` directly.

**`improvements`** is ordered high → medium → low priority. 5–8 items.

**`rewrites`** covers the 2–3 weakest sections only.

### Job Match — request / response

`POST /documents/{id}/job-match`

Request body:
```json
{ "job_description": "We're looking for a Senior Engineer with 5+ years..." }
```

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

The job-match prompt uses `parsed_data` (structured skills, experience, education JSON already on the DynamoDB item) as the resume context — not raw text. This gives better signal quality at any length and requires no additional storage.

## Backend Changes

### `lambda/document_processor/lambda_function.py`

**Add `ANALYSIS_SYSTEM_PROMPT`**

A focused prompt that receives the `parsed_data` JSON and raw resume text. Key constraint language (verbatim in prompt):
> "contact_info MAX is 20, skills MAX is 25, experience MAX is 30, education MAX is 15, formatting MAX is 10. These are hard limits — never return a score value above its category max."

Returns the `analysis` JSON object exactly as specified in the data model above.

**Add `analyze_resume_deep(parsed_data, raw_text, api_key)`**

Same pattern as `analyze_resume_with_llm`:
- Creates `OpenAI(api_key=api_key)` client
- Calls `gpt-4o-mini` with `response_format={"type": "json_object"}`
- Temperature `0.2` (slightly higher than parse to allow expressive improvement text)
- `max_tokens=2500`
- Returns parsed JSON dict

After receiving the response, compute `total` server-side:
```python
breakdown = result["score"]["breakdown"]
result["score"]["total"] = sum(v["score"] for v in breakdown.values())
```

**Update `lambda_handler`**

After `parsed_data = analyze_resume_with_llm(...)` succeeds, call `analyze_resume_deep()` in a `try/except`. On success, pass `analysis=analysis_data` to `store_results`. On failure, log the error and proceed — the document stores as COMPLETED with `parsed_data` intact, analysis panel simply absent in the UI.

**Update `store_results`**

Add optional `analysis` parameter. If provided, store as `item["analysis"]` with the same `Decimal` conversion as `parsed_data`.

### `lambda/results_api/lambda_function.py`

**New env var:** `SSM_PARAMETER_NAME` — same SSM parameter as document_processor.

**Add `get_openai_api_key()`** — identical SSM caching pattern as document_processor.

**Update `CORS_HEADERS`** — add `POST` to `Access-Control-Allow-Methods`.

**Add `job_match(document_id, job_description)`**
1. Fetch item from DynamoDB by `document_id`
2. Return 404 if not found; 400 if `parsed_data` absent (document not yet processed)
3. Serialize `parsed_data` to JSON string as resume context
4. Call `gpt-4o-mini` with job-match prompt (temperature 0.3, max_tokens 1000, json_object response format)
5. Return `response(200, result)`

**Update `lambda_handler`**
- Add `POST` branch: `POST /documents/{id}/job-match` → `job_match(path_params["id"], body["job_description"])`
- Parse body: `body = json.loads(event.get("body") or "{}")`
- Validate `job_description` present and non-empty; return 400 if missing

## Frontend Changes (`frontend/index.html`)

### Hash-based routing

```javascript
function renderPage() {
  const hash = location.hash;
  if (hash.startsWith('#doc/')) {
    const id = hash.slice(5);
    showAnalysisPage(id);   // immediately fetches GET /documents/{id}
  } else {
    showHomePage();
  }
}
window.addEventListener('hashchange', renderPage);
renderPage(); // fires on load — direct-link to #doc/abc123 works immediately
```

`showAnalysisPage(id)` fetches `GET /documents/{id}` immediately (no interaction required), shows a loading state while in-flight, then calls `renderAnalysisPage(doc)` on success.

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
- State stored in a JS `Set` of checked IDs — ephemeral, resets on page load

### Rewrite suggestion cards

- Collapsed by default showing section name + expand chevron
- Expanded: original text (dim, faint strikethrough style) above suggested rewrite (bright)
- "Copy" button copies suggested text to clipboard via `navigator.clipboard.writeText()`

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
| `job_description` missing from POST body | API returns 400 with clear error message |
| `parsed_data` absent (doc still PROCESSING) | Job-match returns 400: "Document not yet processed" |

## Out of Scope

- Persisting improvement card checkoffs to DynamoDB
- Re-analyzing documents uploaded before this feature ships
- Job match history / saving past job descriptions
- Batch analysis of existing documents
