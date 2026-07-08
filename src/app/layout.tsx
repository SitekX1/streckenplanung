import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Trassenplaner — Glasfaser Streckenplanung',
  description: 'Werkzeug zur Planung von Glasfaser-Trassen und Hausanschlüssen',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="de" className={`${geist.variable} h-full overflow-hidden antialiased`}>
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  )
}
