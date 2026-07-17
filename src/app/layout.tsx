import type { Metadata } from "next"
import { Geist } from "next/font/google"
import Script from "next/script"
import "./globals.css"

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "PesoWise — Smart Personal & Business Finance Tracker",
  description: "Track your expenses, manage budgets, and grow your wealth with AI-powered insights. Built for Filipinos.",
  keywords: "personal finance, expense tracker, budget, Philippines, peso, savings",
  openGraph: {
    title: "PesoWise — Smart Finance Tracker",
    description: "AI-powered personal and business finance for Filipinos",
    type: "website",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pixelId = process.env.NEXT_PUBLIC_FB_PIXEL_ID

  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        {children}
        {pixelId && (
          <Script id="fb-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
              n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
              document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${pixelId}');
              fbq('track', 'PageView');
            `}
          </Script>
        )}
      </body>
    </html>
  )
}
