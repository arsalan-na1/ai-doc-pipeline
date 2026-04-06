# Resume Intelligence Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Resume Score, ATS Check, Career Level, Improvement Suggestions, Rewrite Suggestions, and Job Match to the AI Document Pipeline.

**Architecture:** Two targeted GPT-4o-mini calls at upload time (existing parse + new analysis), one new on-demand POST endpoint for Job Match. No new Lambdas or DynamoDB tables. Frontend switches from modal to hash-routed full-page analysis view.

**Tech Stack:** Python 3.11, AWS Lambda, DynamoDB, API Gateway, OpenAI gpt-4o-mini, single-file HTML/CSS/JS frontend

**Spec:** `docs/superpowers/specs/2026-03-25-resume-intelligence-features-design.md`

---

## Task 1: Write failing tests for `analyze_resume_deep()`

**File:** `tests/test_document_processor.py` (create)

**Goal:** Establish test infrastructure and write failing tests for the new analysis function before implementing it.

**Changes:**
- Create `tests/__init__.py` (empty)
- Create `tests/test_document_processor.py` with env vars (`DYNAMODB_TABLE`, `SSM_PARAMETER_NAME`) set before import
- Mock `fitz` and `pdfplumber` in `sys.modules` before importing `lambda_function` (binary Lambda layer deps unavailable locally)
- Add helper `make_mock_openai_response(content_dict)` that returns a mock matching `response.choices[0].message.content`
- Add `SAMPLE_ANALYSIS_RESPONSE` fixture dict matching the spec's `analysis` JSON schema (5 category scores summing to 82)
- Write `test_analyze_resume_deep_computes_total_server_side` — mocks OpenAI, asserts `result["score"]["total"] == 82` and is `int`
- Write `test_analyze_resume_deep_preserves_all_fields` — asserts all 6 top-level keys present (`score`, `ats`, `career_level`, `career_level_advice`, `improvements`, `rewrites`)
- Write `test_analyze_resume_deep_truncates_raw_text_to_6000` — passes 10,000-char string, asserts the user message sent to OpenAI contains at most 6,000 chars of raw text
- Run `pip install pytest boto3 openai` then `pytest tests/test_document_processor.py -v`

**Test:** All three tests should fail with `AttributeError` or `ImportError` because `analyze_resume_deep` does not exist yet.

**Commit:** `test: add failing tests for analyze_resume_deep`

---

## Task 2: Implement `ANALYSIS_SYSTEM_PROMPT` + `analyze_resume_deep()`

**File:** `lambda/document_processor/lambda_function.py`

**Goal:** Add the analysis function that scores, evaluates ATS, detects career level, suggests improvements, and generates rewrite suggestions.

**Changes:**
- Add `ANALYSIS_SYSTEM_PROMPT` constant after the existing `SYSTEM_PROMPT` — includes the exact JSON schema from the spec, the verbatim hard-limit language ("contact_info MAX is 20, skills MAX is 25, experience MAX is 30, education MAX is 15, formatting MAX is 10. These are hard limits — never return a score value above its category max."), rules for 5–8 improvements ordered by priority, 2–3 rewrites for weakest sections, and instruction to omit `total` from the score object
- Add `analyze_resume_deep(parsed_data, raw_text, api_key)` function following the same pattern as `analyze_resume_with_llm`: creates `OpenAI(api_key=api_key)`, sends `json.dumps(parsed_data)` + `raw_text[:6000]` as user message, uses `response_format={"type": "json_object"}`, temperature `0.2`, `max_tokens=2500`
- After parsing GPT response, compute total server-side: `result["score"]["total"] = int(sum(v["score"] for v in result["score"]["breakdown"].values()))`
- Run `pytest tests/test_document_processor.py -v` — all 3 tests should pass

**Test:** The three tests from Task 1 now pass, confirming server-side total computation, field preservation, and text truncation.

**Commit:** `feat: add ANALYSIS_SYSTEM_PROMPT and analyze_resume_deep`

---

## Task 3: Update `store_results` to persist `analysis` field

**File:** `lambda/document_processor/lambda_function.py`

**Goal:** Allow `store_results` to accept and persist the analysis blob in DynamoDB with proper Decimal conversion.

**Changes:**
- Add `analysis=None` parameter to `store_results` signature (after `error_message`)
- Add block: if `analysis` is truthy, store as `item["analysis"]` using `json.loads(json.dumps(analysis), parse_float=Decimal)` — same conversion as `parsed_data`
- Add tests in `tests/test_document_processor.py`:
  - `test_store_results_saves_analysis_field` — mocks `table`, calls `store_results` with analysis dict, asserts `item["analysis"]` exists with Decimal-converted scores
  - `test_store_results_without_analysis_omits_field` — calls without analysis arg, asserts `"analysis" not in item`
- Run `pytest tests/test_document_processor.py -v` — all 5 tests pass

**Test:** Verifies analysis is stored with Decimal conversion when provided, and omitted cleanly when not.

**Commit:** `feat: store_results accepts optional analysis parameter`

---

## Task 4: Update `lambda_handler` to call `analyze_resume_deep()` after parse

**File:** `lambda/document_processor/lambda_function.py`

**Goal:** Wire the analysis call into the upload pipeline with graceful degradation if it fails.

**Changes:**
- After `parsed_data = analyze_resume_with_llm(extracted_text, api_key)` (line ~198), add `analysis_data = None` then `try/except` block calling `analyze_resume_deep(parsed_data, extracted_text, api_key)` — on success assign to `analysis_data`, on failure `logger.error` and continue
- Update the existing `store_results(...)` call (line ~201) to add `analysis=analysis_data` while retaining all existing kwargs (`session_id`, `parsed_data`, `extracted_text`)
- Add tests in `tests/test_document_processor.py`:
  - `test_lambda_handler_passes_analysis_to_store_results` — mocks `s3_client`, `extract_text_from_pdf`, `analyze_resume_with_llm`, `analyze_resume_deep`, `store_results`; asserts `store_results` is called with `analysis=<analysis_dict>`
  - `test_lambda_handler_completes_without_analysis_when_deep_fails` — mocks `analyze_resume_deep` to raise `Exception`; asserts `store_results` is called with `analysis=None` and return `statusCode == 200`
- Run `pytest tests/test_document_processor.py -v` — all 7 tests pass

**Test:** Verifies analysis is passed to store_results on success, and document stores as COMPLETED without analysis when the deep analysis call fails.

**Commit:** `feat: wire analyze_resume_deep into lambda_handler with graceful degradation`

---

## Task 5: Write failing tests for `job_match()` and new routing

**File:** `tests/test_results_api.py` (create)

**Goal:** Establish test infrastructure for results_api and write failing tests for job match and routing changes.

**Changes:**
- Create `tests/test_results_api.py` with env vars (`DYNAMODB_TABLE`, `S3_BUCKET`, `SSM_PARAMETER_NAME`) set before import
- Add helper `make_job_match_event(doc_id, body)` that builds a Lambda proxy event for `POST /documents/{doc_id}/job-match`
- Add helper `make_list_event(session_id)` for `GET /documents`
- Write `test_job_match_returns_404_for_missing_document` — mocks `table.get_item` returning empty, asserts 404
- Write `test_job_match_returns_400_for_missing_parsed_data` — item exists but no `parsed_data`, asserts 400 with "not yet processed"
- Write `test_job_match_returns_400_for_empty_job_description` — asserts 400 with "required"
- Write `test_job_match_returns_400_for_oversized_job_description` — sends 5001 chars, asserts 400 with "5000"
- Write `test_job_match_returns_200_with_match_result` — mocks table + OpenAI, asserts 200 with `match_score`, `strong_matches`, `missing_keywords`, `tailoring_tips`
- Write `test_list_documents_excludes_analysis_field` — item in DynamoDB has `analysis` key, asserts it's absent from list response
- Write `test_post_unknown_path_returns_404` — POST to `/unknown`, asserts 404
- Write `test_unsupported_method_returns_405` — DELETE, asserts 405
- Run `pytest tests/test_results_api.py -v`

**Test:** All 8 tests should fail because `job_match` doesn't exist yet and routing hasn't been restructured.

**Commit:** `test: add failing tests for job_match and routing restructure`

---

## Task 6: Add `get_openai_api_key()` + `JOB_MATCH_SYSTEM_PROMPT` + `job_match()` to results_api

**File:** `lambda/results_api/lambda_function.py`

**Goal:** Implement the on-demand job match endpoint that compares a resume against a pasted job description.

**Changes:**
- Add `from openai import OpenAI` import at top
- Add `ssm_client = boto3.client("ssm")` alongside existing AWS clients
- Add module-level `_openai_api_key = None`
- Add `get_openai_api_key()` function — identical pattern to document_processor (SSM `GetParameter` with `WithDecryption=True`, cached in module global)
- Add `JOB_MATCH_SYSTEM_PROMPT` constant — instructs GPT to return exactly `match_score` (int 0–100), `strong_matches` (array), `missing_keywords` (array), `tailoring_tips` (array of 2–4 strings), states field names as hard requirements
- Add `job_match(document_id, job_description)` function:
  1. Fetch item from DynamoDB by `document_id`; return 404 if not found
  2. Return 400 if `parsed_data` absent
  3. Serialize `parsed_data` with `DecimalEncoder` for the prompt
  4. Call `gpt-4o-mini` with `JOB_MATCH_SYSTEM_PROMPT`, temperature 0.3, `max_tokens=1000`, `response_format={"type": "json_object"}`
  5. Return `response(200, json.loads(result_content))`
- Run relevant passing tests from Task 5

**Test:** The `test_job_match_returns_200_with_match_result`, `test_job_match_returns_404_for_missing_document`, `test_job_match_returns_400_for_missing_parsed_data` tests now pass.

**Commit:** `feat: add job_match function with JOB_MATCH_SYSTEM_PROMPT`

---

## Task 7: Restructure routing + update CORS + exclude `analysis` from list response

**File:** `lambda/results_api/lambda_function.py`

**Goal:** Enable POST routing, fix CORS headers, and prevent analysis blob from bloating list responses.

**Changes:**
- Update `CORS_HEADERS` — change `"GET, OPTIONS"` to `"GET, POST, OPTIONS"` in `Access-Control-Allow-Methods`
- Restructure `lambda_handler` method routing: replace flat `if GET ... else: 405` with `if OPTIONS` → `elif GET` (existing routes unchanged) → `elif POST` (parse body, route `/job-match` with validation: empty returns 400, >5000 chars returns 400) → `else: 405`
- Update `list_documents` — in the per-document summary dict loop, ensure `analysis` is not included (same as `parsed_data` is already excluded)
- Run `pytest tests/test_results_api.py -v` — all 8 tests pass

**Test:** Verifies POST routes to job_match correctly, unknown POST paths return 404, unsupported methods return 405, and list_documents excludes the analysis blob.

**Commit:** `feat: restructure routing for POST support, update CORS, exclude analysis from list`

---

## Task 8: Create API Gateway resource `/documents/{id}/job-match`

**File:** `deploy/deploy.sh` (reference only — changes are live AWS CLI commands + deploy.sh update)

**Goal:** Wire up the API Gateway so POST requests reach the results_api Lambda for job match.

**Changes:**
- Look up API Gateway ID via `aws apigateway get-rest-apis` filtering by name `ai-doc-pipeline-api`
- Look up `/documents/{id}` resource ID via `aws apigateway get-resources`
- Create child resource `job-match` under the `{id}` resource via `aws apigateway create-resource`
- Add `POST` method on the new resource with `NONE` auth via `aws apigateway put-method`
- Add Lambda proxy integration pointing to `ai-doc-results-api` via `aws apigateway put-integration`
- Add `OPTIONS` mock integration with `Access-Control-Allow-Methods: GET,POST,OPTIONS` (same pattern as existing `setup_cors()` in deploy.sh)
- Deploy API Gateway stage to `prod` via `aws apigateway create-deployment`
- Add `SSM_PARAMETER_NAME` env var to `ai-doc-results-api` Lambda config via `aws lambda update-function-configuration` (set to same value as `ai-doc-processor`)
- Update `deploy/deploy.sh` Step 9 to create the `/job-match` child resource, add POST method + integration, and call `setup_cors` on it — so future deployments from scratch include it
- Verify with `curl -X POST <api-url>/documents/test123/job-match -d '{"job_description":"test"}' -H 'Content-Type: application/json'` — expect 404 (doc not found, which proves routing works)

**Test:** Curl returns 404 `{"error": "Document not found"}` — confirms API Gateway routes POST to Lambda and the Lambda's job_match function handles it.

**Commit:** `infra: add /job-match API Gateway resource with POST + OPTIONS`

---

## Task 9: Add `#doc-page` overlay HTML + CSS

**File:** `frontend/index.html`

**Goal:** Add the full-page analysis view HTML structure and all associated CSS styles.

**Changes:**
- Wrap existing nav + sections + footer in `<div id="main-content">` (insert opening tag after `<div id="toasts">`, closing tag after `</footer>` before `<!-- How It Works Modal -->`)
- Add `<div id="doc-page" style="display:none">` after the `<!-- Detail Modal -->` div containing:
  - Sticky header with back button (`onclick="location.hash=''"`) , candidate name (`#dp-name`), and "Match to Job" button (`#jm-open-btn`)
  - Content wrapper (`.dp-content`, max-width 860px centered) with section divs: `#dp-score-section` (score ring SVG with `stroke-dasharray="339.3"`, ATS score, career level badge, 5 category bar rows, career advice paragraph), `#dp-ats-section`, `#dp-imp-section`, `#dp-rw-section`, `#dp-resume-section`
  - Loading state (`#dp-loading`) reusing existing `.spin` class
  - Error state (`#dp-error`, hidden by default)
- Add CSS for: `#doc-page` (fixed overlay, z-index 50, dark bg, overflow-y auto), `.dp-header` (sticky, backdrop-blur), `.dp-back` / `.dp-title` / `.dp-match-btn`, `.dp-content`, `.dp-score-hero` (glassmorphism card with flex-wrap), `.dp-score-svg` + `#dp-ring` (CSS transition on stroke-dashoffset), `.dp-score-val` (absolute centered over SVG), `.dp-meta-stat` / `.dp-meta-lbl`, `.dp-bars` / `.dp-bar-row` / `.dp-bar-track` / `.dp-bar-fill` (CSS width transition), `.dp-section` / `.dp-sec-h`, `.dp-issues-list` (with `⚠` pseudo-element), `.imp-card` / `.imp-card.checked` / `.imp-check` / `.imp-badge.high|medium|low` / `.imp-text`, `.rw-card` / `.rw-card.open` / `.rw-header` / `.rw-chevron` / `.rw-body` / `.rw-original` (strikethrough) / `.rw-suggested` (highlighted) / `.rw-copy-btn`
- Manual test: open home page, confirm no visual regression — `#doc-page` is hidden, all existing content renders normally

**Commit:** `feat: add doc-page overlay HTML structure and CSS`

---

## Task 10: Implement `renderAnalysisPage()`

**File:** `frontend/index.html`

**Goal:** Build the JavaScript that populates the analysis page with score ring, category bars, ATS issues, improvement cards, and rewrite suggestion cards.

**Changes:**
- Add `renderAnalysisPage(doc)` function — reads `doc.analysis` and `doc.parsed_data`, calls sub-renderers for each section, hides analysis sections if `doc.analysis` is absent
- Add `renderScoreHero(a)` — sets `#dp-score-num` text, animates `#dp-ring` stroke-dashoffset via `requestAnimationFrame`, sets ATS score and career level text, generates category bar HTML in `#dp-bars` with `data-pct` attributes, animates bar widths after a tick, sets career level advice
- Add `renderATSSection(ats)` — generates `<li>` items in `#dp-ats-issues` from `ats.issues` array
- Add `renderImprovements(improvements)` — generates `.imp-card` divs in `#dp-improvements` with checkbox, text, and priority badge; each card has `onclick="toggleImprovement(this,'${id}')"`
- Add `toggleImprovement(card, id)` — toggles `id` in the `checkedIds` Set, toggles `.checked` class on the card
- Add `renderRewrites(rewrites)` — generates `.rw-card` divs in `#dp-rewrites` with collapsed header (section name + chevron) and expandable body (original in `.rw-original`, suggested in `.rw-suggested`, Copy button)
- Add `toggleRewrite(i)` — toggles `.open` class on `#rw-{i}`
- Add `copyRewrite(btn, text)` — calls `navigator.clipboard.writeText(text)`, changes button text to "Copied!" for 2 seconds
- Refactor `renderModal(doc)` to `renderDocDetails(doc, targetEl)` — same HTML generation but writes to the passed element instead of hardcoded `#modal-body`; call it from `renderAnalysisPage` targeting `#dp-resume-body`

**Test:** Upload a new PDF (which will now have analysis data from Tasks 2–4), click the doc card, verify: score ring animates, 5 category bars fill, ATS issues listed, improvement cards checkable, rewrite cards expand with Copy button, resume details shown at bottom.

**Commit:** `feat: implement renderAnalysisPage with score ring, bars, improvements, rewrites`

---

## Task 11: Add job match drawer + hash routing + refactor `openModal` → hash nav

**File:** `frontend/index.html`

**Goal:** Add the slide-in job match drawer, implement hash-based routing, and replace the modal-based document detail flow.

**Changes:**
- Add `#jm-backdrop` div (fixed, z-index 60, semi-transparent, `onclick="closeJobMatchDrawer()"`, hidden)
- Add `#jm-drawer` div (fixed right, z-index 61, 480px wide, hidden, contains header with title + close button, body with label, textarea `#jm-jd`, analyze button `#jm-analyze-btn`, results container `#jm-results`, error container `#jm-error`)
- Add CSS for `#jm-backdrop`, `#jm-drawer` / `#jm-drawer.open` (translateX transition), `.jm-header` / `.jm-close` / `.jm-body` / `.jm-textarea` / `.jm-btn` / `.jm-error-msg`, `.jm-score-row` / `.jm-score-num` / `.jm-chips` / `.chip-match` / `.chip-miss` / `.jm-tips`
- Add `openJobMatchDrawer()` — shows backdrop, adds `.open` class to drawer
- Add `closeJobMatchDrawer()` — hides backdrop, removes `.open` class, does NOT clear results
- Add `runJobMatch()` — disables button + shows spinner text, calls `POST /documents/${currentDocId}/job-match` with `{job_description}` from textarea, on success calls `renderJobMatchResults(data)`, on error shows message in `#jm-error`, re-enables button
- Add `renderJobMatchResults(data)` — renders match score, strong-matches chips (green), missing-keywords chips (red), tailoring tips list into `#jm-results`
- Add module-level `let checkedIds = new Set()` and `let currentDocId = null`
- Add `renderPage()` function — checks `location.hash`, routes `#doc/` prefix to `showAnalysisPage(id)`, else to `showHomePage()`
- Add `window.addEventListener('hashchange', renderPage)` and call `renderPage()` at bottom of script
- Add `showHomePage()` — hides `#doc-page`, shows `#main-content`, resets `currentDocId`, closes job match drawer
- Add `showAnalysisPage(id)` — re-initializes `checkedIds = new Set()`, sets `currentDocId = id`, hides `#main-content`, shows `#doc-page` with loading state, immediately fetches `GET /documents/${id}`, on success calls `renderAnalysisPage(doc)`, on 404/error shows error with back link
- Update doc card `onclick` in `loadDocs()` — change `el.onclick=()=>openModal(doc.document_id)` to `el.onclick=()=>{location.hash='#doc/'+doc.document_id;}`
- Remove `openModal()` function (no longer called for doc detail)
- Keep `closeModal()` and `#modal` div intact (Escape handler still references it, harmless)
- Update Escape key handler to also call `closeJobMatchDrawer()`
- Remove `renderModal(doc)` (replaced by `renderDocDetails` from Task 10)

**Test:** Click a doc card → hash changes to `#doc/{id}`, analysis page appears. Back button → returns to home. Direct-link `#doc/{id}` on page load → analysis page renders immediately. "Match to Job" button → drawer slides in. Paste JD + click Analyze → results render. X button and backdrop click close the drawer. Escape closes drawer.

**Commit:** `feat: add job match drawer, hash routing, replace modal with full-page analysis`

---

## Deployment

After all 11 tasks are complete:

1. Deploy `document_processor` Lambda — zip and upload via `aws lambda update-function-code`
2. Deploy `results_api` Lambda — zip and upload via `aws lambda update-function-code`
3. Upload frontend — `sed` inject API URL, `aws s3 cp` to frontend bucket
4. Invalidate CloudFront — `aws cloudfront create-invalidation --paths "/*"`
5. Push to GitHub — `git push origin master`
6. Smoke test — upload a PDF, wait for processing, verify analysis page shows scores/ATS/improvements/rewrites, test job match with a sample JD

**Commit:** `feat: deploy resume intelligence features`
