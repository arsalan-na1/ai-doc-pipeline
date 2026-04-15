const BASE = import.meta.env.VITE_API_BASE_URL as string

// ── Types ──────────────────────────────────────────────────────────────────

export interface DocSummary {
  document_id: string
  filename: string
  upload_timestamp: string
  status: "PROCESSING" | "COMPLETED" | "FAILED" | string
  candidate_name?: string
}

export interface ScoreCategory {
  score: number
  max: number
  note: string
}

export interface DocDetail {
  document_id: string
  filename: string
  upload_timestamp: string
  status: string
  session_id?: string
  candidate_name?: string
  parsed_data?: {
    name?: string
    email?: string
    phone?: string
    location?: string
    summary?: string
    skills?: string[]
    experience?: Array<{ title?: string; company?: string; duration?: string; description?: string }>
    education?: Array<{ degree?: string; institution?: string; year?: string }>
    [key: string]: unknown
  }
  analysis?: {
    score?: {
      total: number
      breakdown?: {
        contact_info?: ScoreCategory
        skills?: ScoreCategory
        experience?: ScoreCategory
        education?: ScoreCategory
        formatting?: ScoreCategory
      }
    }
    ats?: {
      score: number
      issues: string[]
    }
    career_level?: string
    career_level_advice?: string
    improvements?: Array<{ id: string; priority: string; text: string }>
    rewrites?: Array<{ section: string; original: string; suggested: string }>
  }
}

export interface JobMatchResult {
  match_score: number
  strong_matches: string[]
  missing_keywords: string[]
  tailoring_tips: string[]
}

// ── Endpoints ──────────────────────────────────────────────────────────────

export async function getUploadUrl(sessionId: string): Promise<{ upload_url: string; document_key: string; file_id: string }> {
  const res = await fetch(`${BASE}/upload-url?session_id=${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(`upload-url failed: ${res.status}`)
  return res.json()
}

export async function uploadToS3(url: string, file: File): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  })
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`)
}

export async function listDocuments(sessionId: string): Promise<DocSummary[]> {
  const res = await fetch(`${BASE}/documents?session_id=${encodeURIComponent(sessionId)}`)
  if (!res.ok) throw new Error(`list documents failed: ${res.status}`)
  const data = await res.json()
  return data.documents ?? []
}

export async function getDocument(documentId: string): Promise<DocDetail> {
  const res = await fetch(`${BASE}/documents/${encodeURIComponent(documentId)}`)
  if (!res.ok) throw new Error(`get document failed: ${res.status}`)
  return res.json()
}

export async function pollDocument(documentId: string, maxMs = 120_000, intervalMs = 3_000): Promise<DocDetail> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const doc = await getDocument(documentId)
    if (doc.status === "COMPLETED" || doc.status === "FAILED") return doc
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error("Polling timed out")
}

export async function jobMatch(documentId: string, jobDescription: string): Promise<JobMatchResult> {
  const res = await fetch(`${BASE}/documents/${encodeURIComponent(documentId)}/job-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_description: jobDescription }),
  })
  if (!res.ok) throw new Error(`job-match failed: ${res.status}`)
  return res.json()
}
