import { useRef, useEffect, useState } from "react"
import { ArrowLeft, Menu, X } from "lucide-react"
import { TextScramble, TextScrambleHandle } from "./ui/text-scramble"

interface NavProps {
  onBack?: () => void
  showBack?: boolean
}

export function Nav({ onBack, showBack }: NavProps) {
  const logoRef = useRef<TextScrambleHandle>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => logoRef.current?.trigger(), 200)
    return () => clearTimeout(t)
  }, [])

  const links = showBack && onBack ? (
    <button
      onClick={() => { onBack(); setMenuOpen(false) }}
      className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-white/70 hover:text-white transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      Back
    </button>
  ) : (
    <a
      href="#"
      onClick={() => setMenuOpen(false)}
      className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors"
    >
      Upload
    </a>
  )

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center justify-between px-6 py-4">
        <TextScramble
          ref={logoRef}
          text="DocAI"
          spanClassName="font-mono font-bold text-base tracking-wider text-white"
        />

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {links}
          {!showBack && (
            <a href="#results" className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors">
              Results
            </a>
          )}
          <a
            href="https://github.com/arsalan-na1/ai-doc-pipeline"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>

        {/* Hamburger (mobile only) */}
        <button
          className="md:hidden p-1.5 text-white/60 hover:text-white transition-colors"
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-white/10 px-6 py-4 flex flex-col gap-4">
          {links}
          {!showBack && (
            <a
              href="#results"
              onClick={() => setMenuOpen(false)}
              className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors"
            >
              Results
            </a>
          )}
          <a
            href="https://github.com/arsalan-na1/ai-doc-pipeline"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
      )}
    </nav>
  )
}
