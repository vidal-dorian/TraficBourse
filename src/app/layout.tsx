import type { Metadata, Viewport } from "next";
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
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {children}
        <footer className="mx-auto max-w-2xl px-4 py-6 text-sm text-neutral-500">
          Contenu éducatif, pas un conseil en investissement.
        </footer>
      </body>
    </html>
  );
}
