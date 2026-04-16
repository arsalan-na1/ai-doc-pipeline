import { ArrowLeft } from "lucide-react"

interface NavProps {
  onBack?: () => void
  showBack?: boolean
}

export function Nav({ onBack, showBack }: NavProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-black/70 backdrop-blur-md border-b border-white/10">
      <span className="font-mono font-bold text-base tracking-wider text-white">DocAI</span>
      <div className="flex items-center gap-6">
        {showBack && onBack ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-white/70 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        ) : (
          <a href="#" className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors">
            Upload
          </a>
        )}
        <a href="#results" className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors">
          Results
        </a>
        <a
          href="https://github.com/arsalan-na1/ai-doc-pipeline"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold tracking-wide text-white/60 hover:text-white transition-colors"
        >
          GitHub
        </a>
      </div>
    </nav>
  )
}
