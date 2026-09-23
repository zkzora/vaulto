import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Providers } from "@/components/providers";

// Self-hosted variable fonts (weights 400–700) so the UI never depends on reaching Google Fonts.
const sora = localFont({
  src: "./fonts/Sora-latin.woff2",
  weight: "400 700",
  variable: "--font-sora",
  display: "swap",
});

const manrope = localFont({
  src: "./fonts/Manrope-latin.woff2",
  weight: "400 700",
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vaulto — Find idle capital. Deploy smarter.",
  description:
    "Vaulto analyzes your treasury, finds unused capital, and recommends optimized IXS RWA strategies powered by OpenServ reasoning.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${sora.variable} ${manrope.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
