import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veille boursière",
  description: "Le brief quotidien des marchés pour comprendre la bourse, sans conseil en investissement.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-screen break-words bg-white text-neutral-900 antialiased">
        <nav aria-label="Navigation principale" className="mx-auto flex max-w-2xl gap-4 px-4 pt-4 text-sm">
          <Link href="/" className="underline underline-offset-2">
            Aujourd&apos;hui
          </Link>
          <Link href="/archives" className="underline underline-offset-2">
            Archives
          </Link>
          <Link href="/marches" className="underline underline-offset-2">
            Marchés
          </Link>
        </nav>
        {children}
        <footer className="mx-auto max-w-2xl px-4 py-6 text-sm text-neutral-500">
          Contenu éducatif, pas un conseil en investissement.
        </footer>
      </body>
    </html>
  );
}
