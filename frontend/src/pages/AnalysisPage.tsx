import { useState, useEffect, useRef } from "react"
import confetti from "canvas-confetti"
import { XCircle, Sparkles, Copy, Check, Download, Share2 } from "lucide-react"
import { Nav } from "../components/Nav"
import { RatingInteraction } from "../components/ui/emoji-rating"
import { ShineBorder } from "../components/ui/shine-border"
import { AnalysisShaderBg } from "../components/ui/shaders-hero-section"
import { getDocument, jobMatch, DocDetail, JobMatchResult } from "../lib/api"

interface AnalysisPageProps {
  docId: string
  onBack: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  contact_info: "Contact Info",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  formatting: "Formatting",
}

const PRIORITY_CARD: Record<string, string> = {
  high:   "border border-red-500/30 border-l-4 border-l-red-500 bg-red-950/40",
  medium: "border border-yellow-500/30 border-l-4 border-l-yellow-500 bg-yellow-950/30",
  low:    "border border-blue-500/30 border-l-4 border-l-blue-500 bg-blue-950/30",
}
const PRIORITY_BADGE: Record<string, string> = {
  high:   "bg-red-500/20 text-red-300 border border-red-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
  low:    "bg-blue-500/20 text-blue-300 border border-blue-500/40",
}
const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

const SHINE = ["#a855f7", "#6366f1", "#06b6d4"] as [string, string, string]

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/50 shrink-0">{children}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-purple-500/40 to-transparent" />
    </div>
  )
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{ background: "rgba(255,255,255,0.07)" }}
    />
  )
}

function AnalysisSkeleton() {
  return (
    <div className="relative z-10 max-w-5xl mx-auto px-6 pt-24 space-y-8">
      <div className="text-center space-y-3">
        <SkeletonBlock className="h-9 w-64 mx-auto" />
        <SkeletonBlock className="h-3 w-32 mx-auto" />
        <SkeletonBlock className="h-6 w-20 mx-auto rounded-full" />
      </div>
      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex flex-col items-center gap-3 md:w-48 mx-auto md:mx-0">
          <SkeletonBlock className="w-40 h-40 rounded-full" />
          <SkeletonBlock className="h-3 w-16" />
        </div>
        <div className="flex-1 w-full space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="space-y-1.5">
              <div className="flex justify-between">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-4 w-8" />
              </div>
              <SkeletonBlock className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
      {[1, 2, 3].map(i => <SkeletonBlock key={i} className="h-20 w-full" />)}
    </div>
  )
}

function buildPrintHTML(rewrites: { section: string; original: string; suggested: string }[], docName: string): string {
  const rows = rewrites.map(rw => {
    const sec = rw.section.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const orig = rw.original.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const sugg = rw.suggested.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    return `<div class="rw">
  <div class="sec">${sec}</div>
  <div class="cols">
    <div class="col orig"><div class="lbl">Original</div><p>${orig}</p></div>
    <div class="col sugg"><div class="lbl">Suggested</div><p>${sugg}</p></div>
  </div>
</div>`
  }).join("")

  const safeName = docName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  return `<!DOCTYPE html>
<html><head><title>Rewrites</title>
<style>
  body{font-family:Arial,sans-serif;padding:32px;color:#111;max-width:900px;margin:0 auto}
  h1{font-size:20px;margin-bottom:6px}
  .meta{font-size:12px;color:#666;margin-bottom:28px}
  .rw{margin-bottom:32px;page-break-inside:avoid;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}
  .sec{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:1px;padding:8px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb}
  .cols{display:grid;grid-template-columns:1fr 1fr}
  .col{padding:16px}.col+.col{border-left:1px solid #e5e7eb}
  .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
  .orig .lbl{color:#dc2626}.sugg .lbl{color:#16a34a}
  p{margin:0;line-height:1.7;font-size:13px;color:#374151}
</style></head><body>
<h1>Resume Rewrites</h1>
<div class="meta">${safeName}</div>
${rows}
</body></html>`
}

function scoreLabel(score: number): { text: string; color: string } {
  if (score >= 80) return { text: "Strong", color: "text-emerald-400" }
  if (score >= 60) return { text: "Good", color: "text-blue-400" }
  if (score >= 40) return { text: "Fair", color: "text-amber-400" }
  return { text: "Needs Work", color: "text-red-400" }
}

export function AnalysisPage({ docId, onBack }: AnalysisPageProps) {
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const hasShot = useRef(false)
  const [displayScore, setDisplayScore] = useState(0)

  const [activeTab, setActiveTab] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)

  const [jdText, setJdText] = useState("")
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchResult, setMatchResult] = useState<JobMatchResult | null>(null)
  const [matchError, setMatchError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const d = await getDocument(docId)
        if (!cancelled) setDoc(d)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load document.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [docId])

  useEffect(() => {
    if (!doc) return
    if (!hasShot.current) {
      hasShot.current = true
      confetti({
        particleCount: 160,
        spread: 70,
        origin: { y: 0.55 },
        colors: ["#a855f7", "#6366f1", "#06b6d4", "#34d399", "#fb923c"],
      })
    }
    const target = doc.analysis?.score?.total ?? 0
    const duration = 1500
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      setDisplayScore(Math.round(ease * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [doc])

  function copyImprovement(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function handleShare() {
    navigator.clipboard.writeText(window.location.href)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  function handleDownloadPDF() {
    const docRewrites = doc?.analysis?.rewrites ?? []
    if (!docRewrites.length) return
    const docName = doc?.parsed_data?.name || doc?.candidate_name || doc?.filename || "Resume"
    const html = buildPrintHTML(docRewrites, docName)
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, "_blank")
    if (win) {
      setTimeout(() => {
        try { win.print() } catch { /* user may have blocked popups */ }
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }, 600)
    } else {
      URL.revokeObjectURL(url)
    }
  }

  async function handleJobMatch() {
    if (!jdText.trim()) return
    setMatchLoading(true)
    setMatchError("")
    setMatchResult(null)
    try {
      const result = await jobMatch(docId, jdText)
      setMatchResult(result)
    } catch (e: unknown) {
      setMatchError(e instanceof Error ? e.message : "Job match failed.")
    } finally {
      setMatchLoading(false)
    }
  }

  const shaderBg = (
    <div className="fixed inset-0 z-0" style={{ opacity: 0.5 }}>
      <AnalysisShaderBg />
    </div>
  )

  if (loading) {
    return (
      <div className="dark min-h-screen text-white">
        {shaderBg}
        <Nav onBack={onBack} showBack />
        <AnalysisSkeleton />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="dark min-h-screen flex items-center justify-center">
        {shaderBg}
        <Nav onBack={onBack} showBack />
        <p className="relative z-10 text-red-400">{error || "Document not found."}</p>
      </div>
    )
  }

  const a = doc.analysis
  const breakdown = a?.score?.breakdown ?? {}
  const atsIssues = a?.ats?.issues ?? []
  const improvements = a?.improvements ?? []
  const rewrites = a?.rewrites ?? []
  const name = doc.parsed_data?.name || doc.candidate_name || doc.filename || "Resume"

  const sortedImprovements = [...improvements].sort(
    (x, y) =>
      (PRIORITY_ORDER[x.priority?.toUpperCase()] ?? 3) -
      (PRIORITY_ORDER[y.priority?.toUpperCase()] ?? 3)
  )

  const R = 60
  const circ = 2 * Math.PI * R
  const displayDash = (displayScore / 100) * circ

  const careerLevel = a?.career_level
    ? a.career_level.charAt(0).toUpperCase() + a.career_level.slice(1)
    : null

  const { text: scoreText, color: scoreColor } = scoreLabel(displayScore)

  return (
    <div className="dark min-h-screen text-white pb-24">
      {shaderBg}
      <Nav onBack={onBack} showBack />

      <div className="relative z-10 max-w-5xl mx-auto px-6 pt-24 space-y-12">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 text-center space-y-2">
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
              {name}
            </h1>
            {doc.filename && (
              <p className="text-xs text-white/40 tracking-wide">{doc.filename}</p>
            )}
            {careerLevel && (
              <span className="inline-block mt-2 text-xs px-3 py-1.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_14px_rgba(168,85,247,0.35)]">
                {careerLevel}
              </span>
            )}
          </div>
          <button
            onClick={handleShare}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            aria-label={shareCopied ? "Link copied" : "Copy share link"}
          >
            {shareCopied
              ? <Check className="w-3.5 h-3.5 text-emerald-400" />
              : <Share2 className="w-3.5 h-3.5" />
            }
            {shareCopied ? "Copied!" : "Share"}
          </button>
        </div>

        {/* Score ring + Breakdown */}
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <div className="flex flex-col items-center gap-3 md:w-48 mx-auto md:mx-0">
            <div
              className="relative inline-flex items-center justify-center drop-shadow-[0_0_28px_rgba(168,85,247,0.45)]"
              role="img"
              aria-label={`ATS Score: ${displayScore} out of 100`}
            >
              <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
                <defs>
                  <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
                <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="12" />
                <circle
                  cx="80" cy="80" r={R} fill="none"
                  stroke="url(#scoreGrad)"
                  strokeWidth="12"
                  strokeDasharray={`${displayDash} ${circ}`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold tabular-nums">{displayScore}</span>
                <span className="text-xs text-white/40 tracking-wide">/ 100</span>
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/40">ATS Score</p>
            <p className={`text-sm font-semibold ${scoreColor}`}>{scoreText}</p>
          </div>

          {Object.keys(breakdown).length > 0 && (
            <div className="flex-1 w-full">
              <SectionHeading>Breakdown</SectionHeading>
              <div className="space-y-4">
                {Object.entries(breakdown).map(([key, cat]) => {
                  if (!cat) return null
                  const pct = cat.max > 0 ? Math.round((cat.score / cat.max) * 100) : 0
                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/70">{CATEGORY_LABELS[key] ?? key}</span>
                        <span className="text-white/40 tabular-nums">{cat.score}/{cat.max}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400 transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {cat.note && <p className="text-xs text-white/35">{cat.note}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Career Advice */}
        {a?.career_level_advice && (
          <section>
            <SectionHeading>Career Advice</SectionHeading>
            <ShineBorder color={SHINE} borderWidth={1} borderRadius={12} className="w-full p-6 bg-white/5 dark:bg-white/5">
              <div className="flex gap-3 items-start">
                <Sparkles className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-base leading-relaxed text-white/80">{a.career_level_advice}</p>
              </div>
            </ShineBorder>
          </section>
        )}

        {/* ATS Issues */}
        <section>
          <SectionHeading>ATS Issues ({atsIssues.length})</SectionHeading>
          {atsIssues.length > 0 ? (
            <ul className="space-y-3">
              {atsIssues.map((issue, i) => (
                <li key={i} className="flex gap-3 items-start text-base p-4 rounded-xl bg-red-950/40 border border-red-500/20">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-white/75 leading-relaxed">{issue}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-emerald-400/80 p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20">
              No ATS issues found — your formatting looks screener-friendly ✓
            </p>
          )}
        </section>

        {/* Improvements */}
        <section>
          <SectionHeading>Improvements ({sortedImprovements.length})</SectionHeading>
          {sortedImprovements.length > 0 ? (
            <ul className="space-y-3">
              {sortedImprovements.map(imp => (
                <li
                  key={imp.id}
                  className={`p-5 rounded-xl text-base group ${PRIORITY_CARD[imp.priority?.toLowerCase()] ?? "border border-white/10 bg-white/5"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2 flex-1">
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${PRIORITY_BADGE[imp.priority?.toLowerCase()] ?? "bg-white/10 text-white/60"}`}>
                        {imp.priority}
                      </span>
                      <p className="text-white/80 leading-relaxed">{imp.text}</p>
                    </div>
                    <button
                      onClick={() => copyImprovement(imp.text, imp.id)}
                      className="shrink-0 p-1.5 rounded-lg opacity-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-white/5 hover:bg-white/10 text-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:opacity-100"
                      aria-label="Copy improvement to clipboard"
                    >
                      {copiedId === imp.id
                        ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                        : <Copy className="w-3.5 h-3.5" />
                      }
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-white/50 p-4 rounded-xl bg-white/5 border border-white/10">
              No improvements needed — your resume looks strong.
            </p>
          )}
        </section>

        {/* Rewrites */}
        <section>
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/50 shrink-0">
                Rewrites ({rewrites.length})
              </h2>
              <div className="flex-1 h-px bg-gradient-to-r from-purple-500/40 to-transparent" />
            </div>
            {rewrites.length > 0 && (
              <button
                onClick={handleDownloadPDF}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Download className="w-3.5 h-3.5" />
                Download PDF
              </button>
            )}
          </div>

          {rewrites.length > 0 ? (
            <>
              <div className="overflow-x-auto pb-1">
                <div className="flex gap-1 min-w-max">
                  {rewrites.map((rw, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveTab(i)}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                        activeTab === i
                          ? "bg-gradient-to-r from-purple-600/80 to-cyan-500/80 text-white shadow-[0_0_12px_rgba(168,85,247,0.3)]"
                          : "bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10"
                      }`}
                    >
                      {rw.section}
                    </button>
                  ))}
                </div>
              </div>

              {rewrites[activeTab] && (
                <div className="mt-3 rounded-xl border border-white/10 overflow-hidden text-base">
                  <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10">
                    <div className="p-5 space-y-2 bg-red-950/25">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-red-400/60">Original</p>
                      <p className="leading-relaxed text-white/55">{rewrites[activeTab].original}</p>
                    </div>
                    <div className="p-5 space-y-2 bg-emerald-950/25">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Suggested</p>
                      <p className="leading-relaxed text-white/85">{rewrites[activeTab].suggested}</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-base text-white/50 p-4 rounded-xl bg-white/5 border border-white/10">
              No rewrites suggested — your phrasing is strong.
            </p>
          )}
        </section>

        {/* Job Match — inline */}
        <section>
          <SectionHeading>Job Match</SectionHeading>
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            {!matchResult ? (
              <div className="p-5 space-y-4">
                <p className="text-sm text-white/50 leading-relaxed">
                  Paste a job description to see your match score, missing keywords, and tailoring tips.
                </p>
                <textarea
                  value={jdText}
                  onChange={e => { setJdText(e.target.value); setMatchError("") }}
                  placeholder="Paste the job description here…"
                  rows={6}
                  maxLength={5000}
                  className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50 text-white placeholder:text-white/30"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/30">{jdText.length}/5000</span>
                  <button
                    onClick={handleJobMatch}
                    disabled={matchLoading || !jdText.trim()}
                    className="px-5 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-cyan-500 text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
                  >
                    {matchLoading ? "Analyzing…" : "Analyze Match"}
                  </button>
                </div>
                {matchError && <p className="text-sm text-red-400">{matchError}</p>}
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                    {matchResult.match_score}%
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-white">Overall Match</p>
                    <p className="text-xs text-white/40">
                      {matchResult.match_score >= 75 ? "Strong fit" : matchResult.match_score >= 50 ? "Moderate fit" : "Needs work"}
                    </p>
                  </div>
                </div>

                {matchResult.strong_matches.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2">Strong Matches</p>
                    <div className="flex flex-wrap gap-2">
                      {matchResult.strong_matches.map((s, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {matchResult.missing_keywords.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Missing Keywords</p>
                    <div className="flex flex-wrap gap-2">
                      {matchResult.missing_keywords.map((k, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">{k}</span>
                      ))}
                    </div>
                  </div>
                )}

                {matchResult.tailoring_tips.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-2">Tailoring Tips</p>
                    <ul className="space-y-2">
                      {matchResult.tailoring_tips.map((tip, i) => (
                        <li key={i} className="text-sm flex gap-2">
                          <span className="text-yellow-400 shrink-0">→</span>
                          <span className="text-white/75">{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => { setMatchResult(null); setJdText("") }}
                  className="text-xs text-white/35 hover:text-white/70 underline transition-colors"
                >
                  Try another job description
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Rating */}
        <section className="pt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-white/35 uppercase tracking-widest">How useful was this analysis?</p>
          <RatingInteraction />
        </section>
      </div>
    </div>
  )
}
