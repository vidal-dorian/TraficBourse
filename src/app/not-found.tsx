import Link from "next/link";

/** French 404: any unknown URL, and a date without a published brief (`notFound()`). */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p className="mt-4 leading-relaxed">
        Aucun brief à cette adresse : la page n&apos;existe pas, ou aucun brief n&apos;a été publié ce jour-là.
      </p>
      <p className="mt-6">
        <Link href="/archives" className="underline underline-offset-2">
          Voir les archives des briefs
        </Link>
      </p>
    </main>
  );
}
