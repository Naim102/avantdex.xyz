import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'avantdex.theme'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null)

function readTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** Light theme by default; the choice is remembered. The attribute is also set early in index.html to avoid a flash. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      try {
        localStorage.setItem(KEY, next)
      } catch {
        /* private mode: keep the in-memory choice */
      }
      return next
    })
  }, [])
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
