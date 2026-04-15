import { useState, useEffect } from "react"
import { HomePage } from "./pages/HomePage"
import { AnalysisPage } from "./pages/AnalysisPage"

function parseHash(): { page: "home" | "doc"; docId?: string } {
  const hash = window.location.hash
  const match = hash.match(/^#doc\/(.+)$/)
  if (match) return { page: "doc", docId: match[1] }
  return { page: "home" }
}

export default function App() {
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    const handler = () => setRoute(parseHash())
    window.addEventListener("hashchange", handler)
    return () => window.removeEventListener("hashchange", handler)
  }, [])

  function navigate(docId: string) {
    window.location.hash = `#doc/${docId}`
  }

  function goHome() {
    window.location.hash = ""
  }

  if (route.page === "doc" && route.docId) {
    return <AnalysisPage docId={route.docId} onBack={goHome} />
  }
  return <HomePage onNavigate={navigate} />
}
