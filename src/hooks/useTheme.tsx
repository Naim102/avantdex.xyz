import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'sky' | 'ink'

export const THEMES: { id: Theme; name: string; note: string; dark: boolean; swatch: [string, string] }[] = [
  { id: 'sky', name: 'Sky', note: 'Light, cool blue (default)', dark: false, swatch: ['#eaf0fb', '#28df99'] },
  { id: 'ink', name: 'Ink', note: 'Dark, easy at night', dark: true, swatch: ['#121213', '#28df99'] },
]

const KEY = 'avantdex.theme'

interface ThemeCtx {
  theme: Theme
  dark: boolean
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeCtx | null>(null)

function readTheme(): Theme {
  const t = document.documentElement.getAttribute('data-theme')
  return THEMES.some((x) => x.id === t) ? (t as Theme) : 'sky'
}

/** The theme is set early in index.html (no flash); here it can be changed and is remembered. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const setTheme = useCallback((t: Theme) => {
    document.documentElement.setAttribute('data-theme', t)
    try {
      localStorage.setItem(KEY, t)
    } catch {
      /* private mode: keep the in-memory choice */
    }
    setThemeState(t)
  }, [])
  const value = useMemo(() => ({ theme, dark: THEMES.find((x) => x.id === theme)?.dark ?? false, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
