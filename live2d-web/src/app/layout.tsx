import type { Metadata } from 'next'
import './globals.css'
import dynamic from 'next/dynamic'

// 彗星背景：客户端组件，SSR 期间渲染占位空节点避免闪烁
const CometBackground = dynamic(
  () => import('@/components/CometBackground').then(m => m.default),
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
        <CometBackground />
        {children}
      </body>
    </html>
  )
}
