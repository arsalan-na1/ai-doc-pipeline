import { useState, useRef, useCallback } from "react"
import Hero from "../components/ui/animated-shader-hero"
import { TextScramble } from "../components/ui/text-scramble"
import { Nav } from "../components/Nav"
import { getSession } from "../lib/session"
import { getUploadUrl, uploadToS3, listDocuments, pollDocument, DocSummary } from "../lib/api"

interface HomePageProps {
  onNavigate: (docId: string) => void
}

type UploadState = "idle" | "uploading" | "processing" | "done" | "error"

export function HomePage({ onNavigate }: HomePageProps) {
  const [uploadState, setUploadState] = useState<UploadState>("idle")
  const [uploadMsg, setUploadMsg] = useState("")
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const didLoadDocs = useRef(false)

  const loadDocs = useCallback(async () => {
    if (loadingDocs) return
    setLoadingDocs(true)
    try {
      const session = getSession()
      const list = await listDocuments(session)
      setDocs(list)
    } catch {
      setDocs([])
    } finally {
      setLoadingDocs(false)
    }
  }, [loadingDocs])

  // Load docs once on mount
  if (!didLoadDocs.current) {
    didLoadDocs.current = true
    loadDocs()
  }

  async function handleFile(file: File) {
    if (!file || file.type !== "application/pdf") {
      setUploadMsg("Only PDF files are supported.")
      setUploadState("error")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadMsg("File too large (max 10 MB).")
      setUploadState("error")
      return
    }

    try {
      setUploadState("uploading")
      setUploadMsg("Uploading…")
      const session = getSession()
      const { upload_url, document_key, file_id: _ } = await getUploadUrl(session)
      await uploadToS3(upload_url, file)

      // derive document_id = sha256(bucket/key)[:16] — we just poll by listing
      // Instead, get doc ID from the key
      const docId = await deriveDocId(document_key)

      setUploadState("processing")
      setUploadMsg("Analyzing your resume…")

      const doc = await pollDocument(docId)

      if (doc.status === "PROCESSED") {
        setUploadState("done")
        setUploadMsg("Analysis complete!")
        onNavigate(docId)
      } else {
        setUploadState("error")
        setUploadMsg("Analysis failed. Please try again.")
      }
    } catch (err: unknown) {
      setUploadState("error")
      setUploadMsg(err instanceof Error ? err.message : "Upload failed.")
    }
  }

  async function deriveDocId(documentKey: string): Promise<string> {
    // document_id = sha256("{bucket}/{key}")[:16] in hex
    // We need the bucket name
    const bucket = import.meta.env.VITE_S3_BUCKET ?? "ai-doc-pipeline-205839628674"
    const text = `${bucket}/${documentKey}`
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
    return hex.slice(0, 16)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const uploadArea = (
    <div className="w-full max-w-2xl mx-auto mt-10 px-4">
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="relative border-2 border-dashed border-orange-300/40 hover:border-orange-300/70 rounded-2xl p-10 text-center cursor-pointer transition-colors bg-black/20 backdrop-blur-sm"
      >
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleInputChange} />
        {uploadState === "idle" && (
          <>
            <p className="text-orange-100/80 text-lg font-medium">Drop your resume here</p>
            <p className="text-orange-100/50 text-sm mt-1">PDF up to 10 MB</p>
          </>
        )}
        {uploadState === "uploading" && (
          <p className="text-orange-300 animate-pulse">{uploadMsg}</p>
        )}
        {uploadState === "processing" && (
          <p className="text-yellow-300 animate-pulse">{uploadMsg}</p>
        )}
        {uploadState === "done" && (
          <p className="text-emerald-300">{uploadMsg}</p>
        )}
        {uploadState === "error" && (
          <p className="text-red-400">{uploadMsg}</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="dark min-h-screen bg-black text-white">
      <Nav />
      <Hero
        headline={{ line1: "AI Document", line2: "Intelligence" }}
        headlineNode={
          <TextScramble
            text="AI DOCUMENT INTELLIGENCE"
            spanClassName="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-orange-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent"
          />
        }
        subtitle="Upload your resume and get instant ATS scoring, improvement suggestions, and job match analysis."
        buttons={{
          primary: {
            text: "Analyze Resume",
            onClick: () => fileRef.current?.click(),
          },
        }}
        trustBadge={{ text: "Powered by AI • Instant results" }}
      />

      {/* Upload drop zone rendered inside hero via absolute positioning workaround:
          We render it below the hero so the hero stays full-screen */}
      <div className="relative z-10 -mt-24 pb-20 px-4">
        {uploadArea}

        {/* Recent documents */}
        {docs !== null && docs.length > 0 && (
          <div className="max-w-2xl mx-auto mt-12">
            <h2 className="text-lg font-semibold text-orange-100/80 mb-4">Recent Analyses</h2>
            <ul className="space-y-3">
              {docs.map(doc => (
                <li
                  key={doc.document_id}
                  onClick={() => onNavigate(doc.document_id)}
                  className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm text-white">
                      {doc.candidate_name || doc.filename || "Resume"}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {doc.upload_timestamp ? new Date(doc.upload_timestamp).toLocaleDateString() : ""}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-medium ${
                      doc.status === "PROCESSED"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : doc.status === "FAILED"
                        ? "bg-red-500/20 text-red-300"
                        : "bg-yellow-500/20 text-yellow-300"
                    }`}
                  >
                    {doc.status === "PROCESSED" ? "Done" : doc.status === "FAILED" ? "Failed" : "Processing…"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
