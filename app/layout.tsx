import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KlangRein - KI-gesteuerte Audio-Verbesserung",
  description:
    "Entferne Hintergrundgeräusche, Füllwörter und verbessere deine Audioqualität sofort mit KI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
