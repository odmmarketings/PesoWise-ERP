"use client"
import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

// Ang `.dark` na klase sa <html> ang nagpapatakbo ng buong dark layer sa
// globals.css. Naka-imbak sa localStorage; ang unang paglalapat ay ginagawa ng
// inline script sa layout (tingnan ang THEME_INIT) para walang puting kislap.
const KEY = "pesowise_theme"

export function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark)
  try { localStorage.setItem(KEY, dark ? "dark" : "light") } catch {}
}

export function ThemeToggle() {
  // Hindi hinuhulaan sa unang render — ang <html> na ang may tunay na sagot,
  // itinakda ng inline script bago pa mag-hydrate.
  const [dark, setDark] = useState(false)
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")) }, [])

  return (
    <button
      onClick={() => { const next = !dark; setDark(next); applyTheme(next) }}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
    >
      {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  )
}
