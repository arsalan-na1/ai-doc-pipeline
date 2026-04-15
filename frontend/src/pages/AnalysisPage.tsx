import { useState, useEffect } from "react"
import { Nav } from "../components/Nav"
import { RatingInteraction } from "../components/ui/emoji-rating"
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

const PRIORITY_COLOR: Record<string, string> = {
  high: "border-red-500/40 bg-red-500/10",
  medium: "border-yellow-500/40 bg-yellow-500/10",
  low: "border-emerald-500/40 bg-emerald-500/10",
}

export function AnalysisPage({ docId, onBack }: AnalysisPageProps) {
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

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

  if (loading) {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <Nav onBack={onBack} showBack />
        <p className="text-muted-foreground animate-pulse">Loading analysis…</p>
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <Nav onBack={onBack} showBack />
        <p className="text-destructive">{error || "Document not found."}</p>
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

  // Score ring circumference
  const R = 52
  const circ = 2 * Math.PI * R
  const dash = (score / 100) * circ

  return (
    <div className="dark min-h-screen bg-background text-foreground pb-32">
      <Nav onBack={onBack} showBack />

      <div className="max-w-3xl mx-auto px-4 pt-24 space-y-10">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold font-heading">{name}</h1>
          {doc.filename && <p className="text-sm text-muted-foreground">{doc.filename}</p>}
          {a?.career_level && (
            <span className="inline-block mt-2 text-xs px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              {a.career_level}
            </span>
          )}
        </div>

        {/* Score ring */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative inline-flex items-center justify-center">
            <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
              <circle cx="70" cy="70" r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="10" />
              <circle
                cx="70" cy="70" r={R} fill="none"
                stroke={score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444"}
                strokeWidth="10"
                strokeDasharray={`${dash} ${circ}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 1s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold">{score}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
          </div>
          <p className="text-sm font-medium text-muted-foreground">ATS Score</p>
        </div>

        {/* Category breakdown */}
        {Object.keys(breakdown).length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Breakdown</h2>
            {Object.entries(breakdown).map(([key, cat]) => {
              if (!cat) return null
              const pct = Math.round((cat.score / cat.max) * 100)
              return (
                <div key={key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/80">{CATEGORY_LABELS[key] ?? key}</span>
                    <span className="text-muted-foreground">{cat.score}/{cat.max}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {cat.note && <p className="text-xs text-muted-foreground">{cat.note}</p>}
                </div>
              )
            })}
          </section>
        )}

        {/* Career advice */}
        {a?.career_level_advice && (
          <section className="rounded-xl border border-border p-5 bg-card space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Career Advice</h2>
            <p className="text-sm leading-relaxed">{a.career_level_advice}</p>
          </section>
        )}

        {/* ATS Issues */}
        {atsIssues.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              ATS Issues ({atsIssues.length})
            </h2>
            <ul className="space-y-2">
              {atsIssues.map((issue, i) => (
                <li key={i} className="flex gap-3 items-start text-sm p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <span className="text-destructive mt-0.5">✕</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Improvement cards */}
        {improvements.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Improvements ({improvements.length})
            </h2>
            <ul className="space-y-3">
              {improvements.map(imp => (
                <li
                  key={imp.id}
                  className={`p-4 rounded-xl border text-sm ${PRIORITY_COLOR[imp.priority] ?? "border-border bg-card"}`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-60 block mb-1">
                    {imp.priority}
                  </span>
                  {imp.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Rewrite suggestions */}
        {rewrites.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Rewrites ({rewrites.length})
            </h2>
            {rewrites.map((rw, i) => (
              <div key={i} className="rounded-xl border border-border overflow-hidden text-sm">
                <div className="px-4 py-2 bg-muted font-medium">{rw.section}</div>
                <div className="grid md:grid-cols-2 divide-x divide-border">
                  <div className="p-4 space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Original</p>
                    <p className="leading-relaxed text-foreground/70">{rw.original}</p>
                  </div>
                  <div className="p-4 space-y-1 bg-emerald-500/5">
                    <p className="text-xs text-emerald-400 uppercase tracking-wide">Suggested</p>
                    <p className="leading-relaxed">{rw.suggested}</p>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Rating */}
        <section className="pt-4 flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">How useful was this analysis?</p>
          <RatingInteraction />
        </section>
      </div>

      {/* Floating Job Match button */}
      <button
        onClick={() => setDrawerOpen(true)}
        className="fixed bottom-6 right-6 z-40 px-5 py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm shadow-lg hover:opacity-90 transition-opacity"
      >
        Job Match
      </button>

      {/* Job Match drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setDrawerOpen(false); setMatchResult(null); setMatchError("") }}
          />
          <div className="relative w-full max-w-lg mx-4 mb-0 sm:mb-0 rounded-t-2xl sm:rounded-2xl bg-card border border-border p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base">Job Match Analysis</h2>
              <button
                onClick={() => { setDrawerOpen(false); setMatchResult(null); setMatchError("") }}
                className="text-muted-foreground hover:text-foreground"
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
                  className="w-full rounded-lg border border-input bg-background p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{jdText.length}/5000</span>
                  <button
                    onClick={handleJobMatch}
                    disabled={matchLoading || !jdText.trim()}
                    className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
                  >
                    {matchLoading ? "Analyzing…" : "Analyze Match"}
                  </button>
                </div>
                {matchError && <p className="text-sm text-destructive">{matchError}</p>}
              </>
            ) : (
              <div className="space-y-4">
                {/* Match score */}
                <div className="flex items-center gap-4">
                  <div className="text-4xl font-bold">{matchResult.match_score}%</div>
                  <div>
                    <p className="font-semibold text-sm">Overall Match</p>
                    <p className="text-xs text-muted-foreground">
                      {matchResult.match_score >= 75 ? "Strong fit" : matchResult.match_score >= 50 ? "Moderate fit" : "Needs work"}
                    </p>
                  </div>
                </div>

                {/* Strong matches */}
                {matchResult.strong_matches.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">Strong Matches</p>
                    <div className="flex flex-wrap gap-2">
                      {matchResult.strong_matches.map((s, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">{s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Missing keywords */}
                {matchResult.missing_keywords.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Missing Keywords</p>
                    <div className="flex flex-wrap gap-2">
                      {matchResult.missing_keywords.map((k, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">{k}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tailoring tips */}
                {matchResult.tailoring_tips.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wide mb-2">Tailoring Tips</p>
                    <ul className="space-y-2">
                      {matchResult.tailoring_tips.map((tip, i) => (
                        <li key={i} className="text-sm flex gap-2">
                          <span className="text-yellow-400 shrink-0">→</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => { setMatchResult(null); setJdText("") }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
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
