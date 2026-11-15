import { DeviceDesktopIcon, MoonIcon, SunIcon } from '@primer/octicons-react'
import { ActionList, ActionMenu, Banner, Heading, Spinner } from '@primer/react'
import { useSession } from './session/useSession'
import { Join } from './session/Join'
import { Host } from './session/Host'
import { Workspace } from './Workspace'

import { useTranslation, type Language } from './i18n'
import { IconButton } from './components/IconButton'
import styles from './App.module.css'
import sessionStyles from './session/session.module.css'
import ui from './components/surfaces.module.css'
import menuStyles from './components/menu.module.css'

const themes = [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const
export type Theme = typeof themes[number][0]
const themeIcons = { auto: DeviceDesktopIcon, light: SunIcon, dark: MoonIcon }

interface AppProps {
  theme: Theme
  appearance: 'light' | 'dark'
  onThemeChange: (theme: Theme) => void
  language: Language
  onLanguageChange: (language: Language) => void
}

export function App({ theme, appearance, onThemeChange, language, onLanguageChange }: AppProps) {
  const t = useTranslation()
  const { session, setSession, authorized, phase, error, offline } = useSession()
  const deviceName = authorized && session?.deviceName
  const nextLanguage = language === 'en' ? 'zh-CN' : 'en'

  return (
    <>
      <header>
        <div className={styles.headerInner}>
          <Heading as="h1" className={styles.brand}>
            <span className={styles.brandIcon} aria-hidden="true" />
            LanDrop
          </Heading>
          <div className={styles.headerControls}>
            {session && <div className={styles.device}>
              {deviceName && <span className={`${styles.clientName} ${ui.truncate}`} dir="auto" title={deviceName}>{deviceName}</span>}
              <span className={styles.connection} data-live={authorized && phase === 'live'}>
                {t(session.host ? 'Host' : authorized ? 'Connected' : 'Guest')}
              </span>
            </div>}
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton icon={themeIcons[appearance]} label={t('Theme')} description={t('Change theme')} className={styles.headerButton} variant="default" />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay align="end" className={menuStyles.surface}>
                <ActionList selectionVariant="single" variant="full">
                  {themes.map(([mode, label]) => {
                    const ThemeIcon = themeIcons[mode]
                    return <ActionList.Item key={mode} selected={theme === mode} onSelect={() => onThemeChange(mode)}>
                      <ActionList.LeadingVisual><ThemeIcon /></ActionList.LeadingVisual>{t(label)}
                    </ActionList.Item>
                  })}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
            <IconButton icon={<span className={styles.languageMark} lang={language} aria-hidden="true">{language === 'zh-CN' ? '中' : 'EN'}</span>}
              label={nextLanguage === 'zh-CN' ? 'Switch to Simplified Chinese' : '切换为英文'}
              className={styles.headerButton} variant="default"
              onClick={() => onLanguageChange(nextLanguage)} />
          </div>
        </div>
      </header>
      <main className={styles.main}>
        {offline && (!session || authorized) && phase !== 'live' && <Banner variant="warning" layout="compact" title={t('Could not reach the host. Retrying…')} />}
        {(!session || (authorized && phase === 'connecting')) && <p className={`${ui.panel} ${styles.loading}`} role="status">
          <Spinner size="small" srText="" />{t(error || 'Connecting to LanDrop…')}
        </p>}
        {session?.host && !authorized && (
          <section className={`${ui.panel} ${sessionStyles.join}`}>
            <Heading as="h2">{t('Open the host page')}</Heading>
            <p>{t(error || 'Open the host URL shown in the terminal, or run landrop host.')}</p>
          </section>
        )}
        {session && !session.host && !authorized && <Join onJoin={setSession} />}
        {session && authorized && phase !== 'connecting' && (
          <>
            {session.host && <Host />}
            <Workspace session={session} />
          </>
        )}
      </main>
    </>
  )
}
