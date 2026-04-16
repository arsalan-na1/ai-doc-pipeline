import { useState, useRef, useCallback, useEffect } from "react"
import { Trophy, ShieldCheck, TrendingUp, Lightbulb, PenLine, Target, Upload, Cpu, Brain, BarChart2 } from "lucide-react"
import Hero from "../components/ui/animated-shader-hero"
import { ShaderAnimation } from "../components/ui/shader-animation"
import { TextScramble, TextScrambleHandle } from "../components/ui/text-scramble"
import { FlipWords } from "../components/ui/flip-words"
import { SparklesCore } from "../components/ui/sparkles"
import { ShineBorder } from "../components/ui/shine-border"
import { TextShimmer } from "../components/ui/text-shimmer"
import { Nav } from "../components/Nav"
import { getSession } from "../lib/session"
import { getUploadUrl, uploadToS3, listDocuments, pollDocument, DocSummary } from "../lib/api"

interface HomePageProps {
  onNavigate: (docId: string) => void
}

type UploadState = "idle" | "uploading" | "processing" | "done" | "error"

type FeatureIcon = typeof Trophy

const FEATURES: { icon: FeatureIcon; title: string; desc: string }[] = [
  { icon: Trophy,      title: "Resume Score",  desc: "ATS-weighted score across 5 categories with specific notes." },
  { icon: ShieldCheck, title: "ATS Check",     desc: "Surface the exact issues automated screeners flag." },
  { icon: TrendingUp,  title: "Career Level",  desc: "Entry, mid, or senior assessment with tailored advice." },
  { icon: Lightbulb,   title: "Improvements",  desc: "5–8 prioritised, actionable recommendations." },
  { icon: PenLine,     title: "Rewrites",      desc: "Side-by-side original vs. suggested rewrites for weak sections." },
  { icon: Target,      title: "Job Match",     desc: "Paste a JD and get match score, gaps, and tailoring tips." },
]

const FLIP_WORDS = ["Smarter", "Faster", "Better", "Instantly"]
const SHINE_COLORS: [string, string, string] = ["#a855f7", "#6366f1", "#06b6d4"]
const DROPZONE_COLORS: [string, string, string] = ["#f97316", "#eab308", "#fb923c"]

type StepIcon = typeof Upload
const HOW_IT_WORKS: { step: number; icon: StepIcon; title: string; desc: string }[] = [
  { step: 1, icon: Upload,    title: "Upload PDF",      desc: "Drop your resume — PDF up to 10 MB." },
  { step: 2, icon: Cpu,       title: "Lambda Parses",   desc: "AWS Lambda extracts and structures text." },
  { step: 3, icon: Brain,     title: "AI Analyzes",     desc: "Nvidia Nemotron LLM scores your resume." },
  { step: 4, icon: BarChart2, title: "Get Results",     desc: "ATS score, improvements, and rewrites." },
]

const TECH_STACK = [
  "AWS Lambda", "DynamoDB", "API Gateway", "S3", "CloudFront",
  "Python", "React", "Vite", "Nvidia Nemotron",
]

export function HomePage({ onNavigate }: HomePageProps) {
  const [uploadState, setUploadState] = useState<UploadState>("idle")
  const [uploadMsg, setUploadMsg] = useState("")
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const didLoadDocs = useRef(false)
  const scrambleRef = useRef<TextScrambleHandle>(null)

  useEffect(() => {
    const t = setTimeout(() => scrambleRef.current?.trigger(), 300)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === "" || window.location.hash === "#") {
        setTimeout(() => scrambleRef.current?.trigger(), 300)
      }
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

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
      const docId = await deriveDocId(document_key)
      setUploadState("processing")
      setUploadMsg("Analyzing your resume…")
      const doc = await pollDocument(docId)
      if (doc.status === "COMPLETED") {
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

  const uploadZoneContent = (() => {
    if (uploadState === "idle")
      return (
        <>
          <p className="text-orange-100/80 text-lg font-medium">Drop your resume here</p>
          <p className="text-orange-100/50 text-sm mt-1">PDF up to 10 MB</p>
        </>
      )
    if (uploadState === "uploading")
      return (
        <TextShimmer
          className="text-base [--base-color:#f97316] [--base-gradient-color:#fef08a]"
          duration={1.5}
        >
          {uploadMsg}
        </TextShimmer>
      )
    if (uploadState === "processing")
      return (
        <TextShimmer
          className="text-base [--base-color:#d97706] [--base-gradient-color:#ffffff]"
          duration={1.0}
        >
          {uploadMsg}
        </TextShimmer>
      )
    if (uploadState === "done")
      return <p className="text-emerald-300">{uploadMsg}</p>
    return <p className="text-red-400">{uploadMsg}</p>
  })()

  const sparkleButton = (
    <div className="relative inline-flex items-center justify-center">
      <SparklesCore
        className="absolute inset-0 w-full h-full pointer-events-none"
        background="transparent"
        particleColor="#fb923c"
        particleDensity={120}
        minSize={1}
        maxSize={2.5}
        speed={3}
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="relative z-10 px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-black rounded-full font-semibold text-lg transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-orange-500/25"
      >
        Analyze Resume
      </button>
    </div>
  )

  return (
    <div className="dark min-h-screen text-white">
      {/* Fixed full-page shader background */}
      <div className="fixed inset-0 z-0" style={{ opacity: 0.65 }}>
        <ShaderAnimation />
      </div>

      <Nav />

      <div className="relative z-10">
      <Hero
        headline={{ line1: "AI Document", line2: "Intelligence Pipeline" }}
        headlineNode={
          <TextScramble
            ref={scrambleRef}
            text="AI DOCUMENT INTELLIGENCE PIPELINE"
            spanClassName="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-orange-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent"
          />
        }
        subtitle="Analyze your resume"
        subtitleNode={
          <p className="text-lg md:text-xl lg:text-2xl text-orange-100/90 font-light leading-relaxed flex items-center justify-center gap-2 flex-wrap">
            Analyze your resume
            <FlipWords words={FLIP_WORDS} duration={2000} className="text-orange-300 font-semibold" />
          </p>
        }
        trustBadge={{ text: "Powered by AI • Instant results" }}
        primaryButtonNode={sparkleButton}
      />
      </div>

      <div className="relative z-10 -mt-24 pb-20 px-4">

        {/* Upload drop zone — ShineBorder */}
        <div className="w-full max-w-2xl mx-auto mt-10">
          <ShineBorder
            color={DROPZONE_COLORS}
            borderWidth={2}
            borderRadius={16}
            className="w-full p-0 bg-black/20 dark:bg-black/20"
          >
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-2xl p-10 text-center cursor-pointer"
            >
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleInputChange}
              />
              {uploadZoneContent}
            </div>
          </ShineBorder>
        </div>

        {/* Feature grid — ShineBorder on each card */}
        <div className="max-w-3xl mx-auto mt-16">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-orange-300/60 mb-6">
            What you get
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(f => {
              const Icon = f.icon
              return (
                <ShineBorder
                  key={f.title}
                  color={SHINE_COLORS}
                  borderWidth={2}
                  borderRadius={16}
                  className="w-full p-5 bg-white/5 dark:bg-white/5"
                >
                  <Icon className="w-6 h-6 mb-3 text-orange-400" />
                  <p className="font-semibold text-sm text-white mb-1">{f.title}</p>
                  <p className="text-xs text-white/50 leading-relaxed">{f.desc}</p>
                </ShineBorder>
              )
            })}
          </div>
        </div>

        {/* How it works */}
        <div className="max-w-5xl mx-auto mt-16">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-orange-300/60 mb-8">
            How It Works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOW_IT_WORKS.map((s, i) => {
              const Icon = s.icon
              return (
                <div key={s.step} className="relative p-5 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 flex items-center justify-center text-black font-bold text-xs shrink-0">
                      {s.step}
                    </div>
                    {i < HOW_IT_WORKS.length - 1 && (
                      <span className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-white/20 text-xl z-10 pointer-events-none">›</span>
                    )}
                  </div>
                  <Icon className="w-5 h-5 text-orange-400" />
                  <div>
                    <p className="font-semibold text-sm text-white mb-1">{s.title}</p>
                    <p className="text-xs text-white/50 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Tech stack badges */}
        <div className="max-w-5xl mx-auto mt-8">
          <div className="flex flex-wrap justify-center gap-2">
            {TECH_STACK.map(tech => (
              <span
                key={tech}
                className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-white/50 hover:text-white/70 hover:border-white/20 transition-colors"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* Recent analyses — ShineBorder on each card */}
        {docs !== null && docs.length > 0 && (
          <div className="max-w-2xl mx-auto mt-12" id="results">
            <h2 className="text-lg font-semibold text-orange-100/80 mb-4">Recent Analyses</h2>
            <ul className="space-y-3">
              {docs.map(doc => (
                <ShineBorder
                  key={doc.document_id}
                  color={SHINE_COLORS}
                  borderWidth={1}
                  borderRadius={12}
                  className="w-full p-4 bg-zinc-900 dark:bg-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                  onClick={() => onNavigate(doc.document_id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-white">
                        {doc.candidate_name || doc.filename || "Resume"}
                      </p>
                      <p className="text-xs text-white/40 mt-0.5">
                        {doc.upload_timestamp ? new Date(doc.upload_timestamp).toLocaleDateString() : ""}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        doc.status === "COMPLETED"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : doc.status === "FAILED"
                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                      }`}
                    >
                      {doc.status === "COMPLETED" ? "Done" : doc.status === "FAILED" ? "Failed" : "Processing…"}
                    </span>
                  </div>
                </ShineBorder>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
