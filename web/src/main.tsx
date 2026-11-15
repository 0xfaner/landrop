import { useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BaseStyles } from '@primer/react'
import { ThemeProvider } from '@primer/react/next'
import { App, type Theme } from './App'
import { LanguageContext, type Language } from './i18n'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './style.css'

const themeKey = 'landrop.theme'
const languageKey = 'landrop.language'
const systemTheme = matchMedia('(prefers-color-scheme: dark)')
const page = document.documentElement

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(themeKey)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  return 'auto'
}

function loadLanguage(): Language {
  try {
    const stored = localStorage.getItem(languageKey)
    if (stored === 'en' || stored === 'zh-CN') return stored
  } catch {}
  return /^zh(?:-|$)/i.test(navigator.language) ? 'zh-CN' : 'en'
}

const initialTheme = loadTheme()
const initialLanguage = loadLanguage()
page.dataset.colorMode = initialTheme === 'auto' ? (systemTheme.matches ? 'dark' : 'light') : initialTheme
page.lang = initialLanguage

function Root() {
  const [theme, setTheme] = useState(initialTheme)
  const [language, setLanguage] = useState(initialLanguage)
  const [systemDark, setSystemDark] = useState(() => systemTheme.matches)
  const appearance = theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const sync = () => setSystemDark(systemTheme.matches)
    systemTheme.addEventListener('change', sync)
    sync()
    return () => systemTheme.removeEventListener('change', sync)
  }, [])

  useLayoutEffect(() => {
    page.dataset.colorMode = appearance
    page.lang = language
  }, [appearance, language])

  function chooseTheme(next: Theme) {
    setTheme(next)
    try { localStorage.setItem(themeKey, next) } catch {}
  }

  function chooseLanguage(next: Language) {
    setLanguage(next)
    try { localStorage.setItem(languageKey, next) } catch {}
  }

  return (
    <ThemeProvider colorMode={appearance} contextOnly>
      <BaseStyles>
        <LanguageContext.Provider value={language}>
          <App theme={theme} appearance={appearance} onThemeChange={chooseTheme}
            language={language} onLanguageChange={chooseLanguage} />
        </LanguageContext.Provider>
      </BaseStyles>
    </ThemeProvider>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Root />)
