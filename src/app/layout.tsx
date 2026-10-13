import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "StrongProxy · Residential & mobile proxies, paid in naira", template: "%s · StrongProxy" },
  description:
    "Residential and mobile proxies in the US, UK, Canada, Australia and Europe. Pay per GB in naira with Paystack, or in USDT.",
  openGraph: {
    title: "StrongProxy",
    description: "Residential and mobile proxies, paid in naira.",
    siteName: "StrongProxy",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f4ef",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
