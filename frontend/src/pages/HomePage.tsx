import { useState, useRef, useEffect, Fragment, type ReactNode } from "react"
import { Trophy, ShieldCheck, TrendingUp, Lightbulb, PenLine, Target, Upload, Cpu, Brain, BarChart2, UploadCloud } from "lucide-react"
import Hero from "../components/ui/animated-shader-hero"
import { Warp } from "@paper-design/shaders-react"
import { TextScramble, TextScrambleHandle } from "../components/ui/text-scramble"
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

const SHINE_COLORS: [string, string, string] = ["#a855f7", "#6366f1", "#06b6d4"]
const DROPZONE_COLORS: [string, string, string] = ["#f97316", "#eab308", "#fb923c"]

const STATS = ["ATS Score", "5–8 Improvements", "Side-by-side Rewrites", "Free"]

type StepIcon = typeof Upload
const HOW_IT_WORKS: { step: number; icon: StepIcon; title: string; desc: string }[] = [
  { step: 1, icon: Upload,    title: "Upload PDF",    desc: "Drop your resume — PDF up to 10 MB." },
  { step: 2, icon: Cpu,       title: "Lambda Parses", desc: "AWS Lambda extracts and structures text." },
  { step: 3, icon: Brain,     title: "AI Analyzes",   desc: "Nvidia Nemotron LLM scores your resume." },
  { step: 4, icon: BarChart2, title: "Get Results",   desc: "ATS score, improvements, and rewrites." },
]

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.08 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, visible }
}

function RevealSection({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  const { ref, visible } = useScrollReveal()
  return (
    <div
      id={id}
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  )
}

export function HomePage({ onNavigate }: HomePageProps) {
  const [uploadState, setUploadState] = useState<UploadState>("idle")
  const [uploadMsg, setUploadMsg] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrambleRef = useRef<TextScrambleHandle>(null)

  useEffect(() => {
    const t = setTimeout(() => scrambleRef.current?.trigger(), 300)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const session = getSession()
        const list = await listDocuments(session)
        if (!cancelled) setDocs(list)
      } catch {
        if (!cancelled) setDocs([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

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
    setIsDragOver(false)
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
          <UploadCloud className="w-10 h-10 mx-auto mb-4 text-orange-400/60" />
          <p className="text-orange-100/80 text-lg font-medium">Drop your resume here</p>
          <p className="text-orange-100/50 text-sm mt-1">or click to browse · PDF up to 10 MB</p>
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
        particleDensity={50}
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
      <Nav />

      {/* Hero — shader scoped here only */}
      <div className="relative h-screen overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none" style={{ opacity: 0.35 }}>
          <Warp
            style={{ width: "100%", height: "100%" }}
            proportion={0.45}
            softness={1}
            distortion={0.25}
            swirl={0.8}
            swirlIterations={10}
            shape="checks"
            shapeScale={0.1}
            scale={1}
            rotation={0}
            speed={1}
            colors={["#1a0533", "#f97316", "#7c3aed", "#fbbf24"]}
          />
        </div>
        <Hero
          headline={{ line1: "Land More", line2: "Interviews" }}
          headlineNode={
            <TextScramble
              ref={scrambleRef}
              text="LAND MORE INTERVIEWS"
              spanClassName="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-orange-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent"
            />
          }
          subtitle=""
          subtitleNode={
            <p className="text-lg md:text-xl text-orange-100/75 font-light leading-relaxed max-w-xl mx-auto text-center">
              Get an ATS score, rewritten bullets, and tailored job-match feedback — in under 2 minutes.
            </p>
          }
          trustBadge={{ text: "Free · No signup · Instant results" }}
          primaryButtonNode={sparkleButton}
        />
      </div>

      <div className="relative z-10 -mt-24 pb-20 px-4">

        {/* Upload drop zone */}
        <div className="w-full max-w-2xl mx-auto mt-10">
          <ShineBorder
            color={DROPZONE_COLORS}
            borderWidth={2}
            borderRadius={16}
            className="w-full p-0 bg-black/20 dark:bg-black/20"
          >
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => fileRef.current?.click()}
              className={`w-full rounded-2xl p-10 text-center cursor-pointer border-2 border-dashed transition-all duration-200 ${
                isDragOver
                  ? "border-orange-400/80 bg-orange-500/10"
                  : uploadState === "idle" ? "border-orange-500/25" : "border-transparent"
              }`}
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

        {/* Stats bar */}
        <RevealSection className="w-full max-w-2xl mx-auto mt-5">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-5 py-3 rounded-full border border-white/10 bg-black/30 backdrop-blur-sm">
            {STATS.map((stat, i) => (
              <Fragment key={stat}>
                <span className="text-xs text-white/55 font-medium tracking-wide">{stat}</span>
                {i < STATS.length - 1 && (
                  <span className="text-white/20 text-xs select-none" aria-hidden="true">·</span>
                )}
              </Fragment>
            ))}
          </div>
        </RevealSection>

        {/* Feature grid */}
        <RevealSection className="max-w-3xl mx-auto mt-16">
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
        </RevealSection>

        {/* How It Works */}
        <RevealSection className="max-w-5xl mx-auto mt-16">
          <h2 className="text-center text-sm font-semibold uppercase tracking-widest text-orange-300/60 mb-8">
            How It Works
          </h2>

          {/* Desktop: flex row with dashed connectors */}
          <div className="hidden lg:flex items-stretch">
            {HOW_IT_WORKS.map((s, i) => {
              const Icon = s.icon
              return (
                <Fragment key={s.step}>
                  <div className="flex-1 p-5 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 flex items-center justify-center text-black font-bold text-xs shrink-0">
                      {s.step}
                    </div>
                    <Icon className="w-5 h-5 text-orange-400" />
                    <div>
                      <p className="font-semibold text-sm text-white mb-1">{s.title}</p>
                      <p className="text-xs text-white/50 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="flex items-center px-3" aria-hidden="true">
                      <div className="w-8 border-t-2 border-dashed border-orange-500/30" />
                    </div>
                  )}
                </Fragment>
              )
            })}
          </div>

          {/* Mobile: 2-col grid */}
          <div className="lg:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
            {HOW_IT_WORKS.map(s => {
              const Icon = s.icon
              return (
                <div key={s.step} className="p-5 rounded-xl bg-white/5 border border-white/10 flex flex-col gap-3">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 flex items-center justify-center text-black font-bold text-xs shrink-0">
                    {s.step}
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
        </RevealSection>

        {/* Recent analyses */}
        {docs !== null && docs.length > 0 && (
          <RevealSection id="results" className="max-w-2xl mx-auto mt-12">
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
          </RevealSection>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 mt-8 border-t border-white/10 bg-black/40 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/40">
          <span className="font-mono tracking-wider">DocAI © 2026</span>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/arsalan-na1/ai-doc-pipeline"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white/70 transition-colors"
            >
              GitHub
            </a>
            <a href="#" className="hover:text-white/70 transition-colors">Upload</a>
            <a href="#results" className="hover:text-white/70 transition-colors">Results</a>
          </div>
          <span className="text-center sm:text-right">Built on AWS Free Tier · Powered by Nvidia Nemotron</span>
        </div>
      </footer>
    </div>
  )
}
