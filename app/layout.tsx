import type { Metadata } from "next";
import { DM_Serif_Display, DM_Sans } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import { AuthProvider } from "./context/AuthContext";

const dmSerifDisplay = DM_Serif_Display({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-serif-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MP3 lauter machen & Audio bereinigen – KlangRein",
  description:
    "Audio lauter machen, Hintergrundgeräusche entfernen und Lautstärke anpassen – kostenlos im Browser. Kein Download nötig. Für MP3, WAV, M4A und FLAC.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <head>
        <meta name="theme-color" content="#BF6F84" />
        <meta name="google-site-verification" content="IB-b4vCzD_1zeuIXlHIvn5W4e3s0raaMAcIPbpmeeJA" />
      </head>
      <body className={`${dmSerifDisplay.variable} ${dmSans.variable}`}>
        <AuthProvider>
          {children}
        </AuthProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
