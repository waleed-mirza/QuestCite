import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { appConfig } from "@/config/app";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appConfig.url),
  title: {
    default: `${appConfig.name} — security questionnaires on autopilot`,
    template: `%s · ${appConfig.name}`,
  },
  description:
    "Import a security questionnaire, draft answers from your own trusted knowledge base with inline citations, run review, and export. Plus a public Trust Center for buyer requests.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
