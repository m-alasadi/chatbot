import { Metadata, Viewport } from "next"
import { Readex_Pro } from "next/font/google"
import { ReactNode } from "react"
import "./globals.css"

const APP_NAME = "مساعد مشاريع العتبة العباسية"
const APP_DEFAULT_TITLE = "مساعد مشاريع العتبة العباسية"
const APP_DESCRIPTION = "مساعد ذكي للاستعلام عن مشاريع العتبة العباسية المقدسة"

const readexPro = Readex_Pro({
  subsets: ["arabic", "latin"],
  weight: ["200", "300", "400", "500", "600", "700"],
  display: "swap",
})

interface RootLayoutProps {
  children: ReactNode
  params: {
    locale: string
  }
}

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: APP_DEFAULT_TITLE,
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
    shortcut: "/logo.png",
    other: [
      { rel: "icon", url: "/logo.png", type: "image/png" },
      { rel: "icon", url: "/logo.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/logo.png", sizes: "512x512", type: "image/png" },
    ],
  },
}

export const viewport: Viewport = {
  themeColor: "#0a1628",
}

export default async function RootLayout({
  children,
  params: { locale: _locale },
}: RootLayoutProps) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.png" type="image/png" />
        <link rel="shortcut icon" href="/logo.png" type="image/png" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body className={readexPro.className} style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  )
}
