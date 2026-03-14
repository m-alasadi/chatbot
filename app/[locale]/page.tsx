"use client"

import Script from "next/script"

export default function HomePage() {
  return (
    <>
      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        body {
          background: url('/bg1.png') no-repeat center center fixed;
          background-size: 100% 100%;
        }
      `}</style>

      <Script
        src="/widget.js"
        strategy="afterInteractive"
        onLoad={() => {
          (window as any).AlkafeelWidget?.init({
            apiEndpoint: "/api/chat/site",
            title: "مشاريع العتبة العباسية",
            position: "left",
          })
        }}
      />
    </>
  )
}
