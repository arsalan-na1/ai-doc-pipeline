interface NavProps {
  onBack?: () => void
  showBack?: boolean
}

export function Nav({ onBack, showBack }: NavProps) {
  return (
    <nav className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-full bg-background/60 backdrop-blur-md border border-border shadow-lg">
      <span className="font-heading font-semibold text-sm text-foreground">DocAI</span>
      {showBack && onBack && (
        <>
          <span className="text-border">|</span>
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        </>
      )}
    </nav>
  )
}
