import { MeshGradient } from "@paper-design/shaders-react"

/**
 * Full-page background shader for the analysis page.
 * Two MeshGradient layers — dark indigo/purple/teal base with a
 * low-opacity purple/cyan accent pass for depth.
 *
 * Intended use: inside a `fixed inset-0 z-0` wrapper with opacity ~0.5.
 */
export function AnalysisShaderBg() {
  return (
    <>
      {/* Base layer — near-black deep purple/teal mesh */}
      <MeshGradient
        className="absolute inset-0 w-full h-full"
        colors={["#05050f", "#1a003a", "#003a5c", "#1a1a3e", "#002233"]}
        speed={0.2}
        distortion={1}
        swirl={0.65}
        grainMixer={0.05}
      />
      {/* Accent layer — vivid purple/cyan at low opacity for color depth */}
      <MeshGradient
        className="absolute inset-0 w-full h-full opacity-40"
        colors={["#a855f7", "#06b6d4", "#7c3aed", "#0891b2"]}
        speed={0.12}
        distortion={0.6}
        swirl={0.4}
      />
    </>
  )
}
