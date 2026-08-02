import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Live2D AI Layer Splitter',
  description: 'AI-powered anime character layer splitting for Live2D rigging',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
