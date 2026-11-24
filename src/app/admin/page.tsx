import type { Metadata } from "next";
import Link from "next/link";

// Rendered per request, never prerendered: only the owner reaches it (see src/middleware.ts).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administration — Veille boursière",
  robots: { index: false, follow: false },
};

/** Provisional admin home: the admin tools arrive in later stories. */
export default function AdminPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Administration</h1>
      <p className="mt-4 leading-relaxed">Page provisoire, réservée au propriétaire du site.</p>
      <p className="mt-4 leading-relaxed">
        <Link href="/admin/watchlist" className="underline">
          Gérer la watchlist
        </Link>
      </p>
      <p className="mt-4 leading-relaxed">Bientôt ici :</p>
      <ul className="mt-2 list-disc pl-6 leading-relaxed">
        <li>les instruments suivis ;</li>
        <li>le journal des appels MCP ;</li>
        <li>l&apos;état des tâches planifiées.</li>
      </ul>
    </main>
  );
}
