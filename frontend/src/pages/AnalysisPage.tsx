import { useState, useEffect, useRef } from "react"
import confetti from "canvas-confetti"
import { XCircle, Sparkles } from "lucide-react"
import { Nav } from "../components/Nav"
import { RatingInteraction } from "../components/ui/emoji-rating"
import { ShineBorder } from "../components/ui/shine-border"
import { ShaderAnimation } from "../components/ui/shader-animation"
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
  high:   "border-red-500/30 bg-red-950/40",
  medium: "border-yellow-500/30 bg-yellow-950/30",
  low:    "border-blue-500/30 bg-blue-950/30",
}
const PRIORITY_BADGE: Record<string, string> = {
  high:   "bg-red-500/20 text-red-300 border border-red-500/40",
  medium: "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40",
  low:    "bg-blue-500/20 text-blue-300 border border-blue-500/40",
}

const SHINE = ["#a855f7", "#6366f1", "#06b6d4"] as [string, string, string]

// Section heading with gradient rule
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-white/50 shrink-0">{children}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-purple-500/40 to-transparent" />
    </div>
  )
}

export function AnalysisPage({ docId, onBack }: AnalysisPageProps) {
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const hasShot = useRef(false)
  const [displayScore, setDisplayScore] = useState(0)

  // Job match drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
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

  // Confetti + score count-up when data loads
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
    const duration = 1200
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      setDisplayScore(Math.round(ease * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [doc])

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
    <div className="fixed inset-0 z-0" style={{ opacity: 0.55 }}>
      <ShaderAnimation />
    </div>
  )

  if (loading) {
    return (
      <div className="dark min-h-screen flex items-center justify-center">
        {shaderBg}
        <Nav onBack={onBack} showBack />
        <p className="relative z-10 text-white/60 animate-pulse text-sm tracking-wide">Loading analysis…</p>
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
  const score = a?.score?.total ?? 0
  const breakdown = a?.score?.breakdown ?? {}
  const atsIssues = a?.ats?.issues ?? []
  const improvements = a?.improvements ?? []
  const rewrites = a?.rewrites ?? []
  const name = doc.parsed_data?.name || doc.candidate_name || doc.filename || "Resume"

  const R = 60
  const circ = 2 * Math.PI * R
  const dash = (score / 100) * circ

  return (
    <div className="dark min-h-screen text-white pb-32">
      {shaderBg}
      <Nav onBack={onBack} showBack />

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-24 space-y-10">

        {/* ── Header ── */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
            {name}
          </h1>
          {doc.filename && (
            <p className="text-xs text-white/40 tracking-wide">{doc.filename}</p>
          )}
          {a?.career_level && (
            <span className="inline-block mt-2 text-xs px-3 py-1.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_14px_rgba(168,85,247,0.35)]">
              {a.career_level}
            </span>
          )}
        </div>

        {/* ── Score ring ── */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative inline-flex items-center justify-center drop-shadow-[0_0_28px_rgba(168,85,247,0.45)]">
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
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-bold tabular-nums">{displayScore}</span>
              <span className="text-xs text-white/40 tracking-wide">/ 100</span>
            </div>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-white/40">ATS Score</p>
        </div>

        {/* ── Category breakdown ── */}
        {Object.keys(breakdown).length > 0 && (
          <section>
            <SectionHeading>Breakdown</SectionHeading>
            <div className="space-y-3">
              {Object.entries(breakdown).map(([key, cat]) => {
                if (!cat) return null
                const pct = Math.round((cat.score / cat.max) * 100)
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-white/70">{CATEGORY_LABELS[key] ?? key}</span>
                      <span className="text-white/40 tabular-nums">{cat.score}/{cat.max}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
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
          </section>
        )}

        {/* ── Career Advice ── */}
        {a?.career_level_advice && (
          <section>
            <SectionHeading>Career Advice</SectionHeading>
            <ShineBorder color={SHINE} borderWidth={1} borderRadius={12} className="w-full p-5 bg-white/5 dark:bg-white/5">
              <div className="flex gap-3 items-start">
                <Sparkles className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed text-white/80">{a.career_level_advice}</p>
              </div>
            </ShineBorder>
          </section>
        )}

        {/* ── ATS Issues ── */}
        {atsIssues.length > 0 && (
          <section>
            <SectionHeading>ATS Issues ({atsIssues.length})</SectionHeading>
            <ul className="space-y-2">
              {atsIssues.map((issue, i) => (
                <li key={i} className="flex gap-3 items-start text-sm p-3.5 rounded-xl bg-red-950/40 border border-red-500/20">
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="text-white/75">{issue}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Improvements ── */}
        {improvements.length > 0 && (
          <section>
            <SectionHeading>Improvements ({improvements.length})</SectionHeading>
            <ul className="space-y-3">
              {improvements.map(imp => (
                <li
                  key={imp.id}
                  className={`p-4 rounded-xl border text-sm ${PRIORITY_CARD[imp.priority] ?? "border-white/10 bg-white/5"}`}
                >
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full mb-2 ${PRIORITY_BADGE[imp.priority] ?? "bg-white/10 text-white/60"}`}>
                    {imp.priority}
                  </span>
                  <p className="text-white/80 leading-relaxed">{imp.text}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Rewrites ── */}
        {rewrites.length > 0 && (
          <section>
            <SectionHeading>Rewrites ({rewrites.length})</SectionHeading>
            <div className="space-y-4">
              {rewrites.map((rw, i) => (
                <div key={i} className="rounded-xl border border-white/10 overflow-hidden text-sm">
                  <div className="px-4 py-2.5 bg-white/5 border-b border-white/10 font-medium text-white/70 text-xs uppercase tracking-wider">
                    {rw.section}
                  </div>
                  <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10">
                    <div className="p-4 space-y-1.5 bg-red-950/25">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-red-400/60">Original</p>
                      <p className="leading-relaxed text-white/55">{rw.original}</p>
                    </div>
                    <div className="p-4 space-y-1.5 bg-emerald-950/25">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Suggested</p>
                      <p className="leading-relaxed text-white/85">{rw.suggested}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Rating ── */}
        <section className="pt-4 flex flex-col items-center gap-2">
          <p className="text-xs text-white/35 uppercase tracking-widest">How useful was this analysis?</p>
          <RatingInteraction />
        </section>
      </div>

      {/* ── Floating Job Match button ── */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="fixed bottom-6 right-6 z-40 px-5 py-3 rounded-full bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-purple-500/25 hover:opacity-90 transition-opacity"
      >
        Job Match
      </button>

      {/* ── Job Match drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => { setDrawerOpen(false); setMatchResult(null); setMatchError("") }}
          />
          <div className="relative w-full max-w-lg mx-4 mb-0 sm:mb-0 rounded-t-2xl sm:rounded-2xl bg-zinc-900 border border-white/10 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base text-white">Job Match Analysis</h2>
              <button
                onClick={() => { setDrawerOpen(false); setMatchResult(null); setMatchError("") }}
                className="text-white/40 hover:text-white transition-colors"
              >✕</button>
            </div>

            {!matchResult ? (
              <>
                <textarea
                  value={jdText}
                  onChange={e => setJdText(e.target.value)}
                  placeholder="Paste the job description here…"
                  rows={8}
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
              </>
            ) : (
              <div className="space-y-4">
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
        </div>
      )}
    </div>
  )
}
