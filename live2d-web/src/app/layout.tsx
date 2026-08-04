import type { Metadata } from 'next'
import './globals.css'
import dynamic from 'next/dynamic'
import { I18nProvider } from '@/i18n/useT'

// 彗星背景：客户端组件，SSR 期间渲染占位空节点避免闪烁
const CometBackground = dynamic(
  () => import('@/components/CometBackground').then(m => m.default),
  { ssr: false }
)

// 语言切换器：客户端组件
const LanguageSwitcher = dynamic(
  () => import('@/components/LanguageSwitcher').then(m => m.default),
  { ssr: false }
)

// Toast 容器：客户端组件（内部订阅 toastStore）
const ToastContainer = dynamic(
  () => import('@/components/Toast'),
  { ssr: false }
)

export const metadata: Metadata = {
  title: 'Live2D Layer Splitter — AI Anime Decomposition',
  description: 'Split anime character art into transparent layers for Live2D rigging. AI-powered 47-part decomposition, PSD & PNG export.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter（正文）+ Space Grotesk（标题数字）*/}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <I18nProvider>
          <CometBackground />
          {/* 固定在右上角的语言切换器 */}
          <div className="lang-fixed-top">
            <LanguageSwitcher />
          </div>
          <div className="page-shell">
            {children}
          </div>
          {/* 全局页脚 — 版权 & 开源协议声明 */}
          <footer className="app-footer" role="contentinfo">
            <div className="app-footer__inner">
              <p className="app-footer__copy">
                © {new Date().getFullYear()} AI Live2D Studio
                <span className="app-footer__dot" aria-hidden />
                Powered by{' '}
                <a
                  href="https://github.com/lllyasviel/see-through-main"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="app-footer__link"
                >
                  See-Through
                </a>{' '}
                (Apache-2.0)
              </p>
              <nav aria-label="Legal">
                <a href="/legal" className="app-footer__link app-footer__legal">
                  Third-Party Licenses
                </a>
              </nav>
            </div>
          </footer>
          {/* 全局 Toast 容器 */}
          <ToastContainer />
        </I18nProvider>
      </body>
    </html>
  )
}
