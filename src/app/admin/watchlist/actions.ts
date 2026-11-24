"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { createYahooProvider } from "@/lib/market/yahoo";
import { createYahooCurrencyLookup, createYahooSearch } from "@/lib/market/yahoo-search";
import { addStockAsOwner, removeStockAsOwner } from "@/lib/watchlist/owner-actions";
import type { InstrumentSearchResult } from "@/lib/market/search";

// Thin wrappers: the Access check lives in owner-actions, never rely on the middleware alone
// (a server action can be POSTed to any path).

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function done(status: string): never {
  revalidatePath("/admin/watchlist");
  redirect(`/admin/watchlist?status=${status}`);
}

export async function addStock(form: FormData): Promise<void> {
  const result = {
    providerSymbol: field(form, "providerSymbol"),
    name: field(form, "name"),
    exchange: field(form, "exchange") || null,
    type: field(form, "type") as InstrumentSearchResult["type"],
    currency: "",
  };
  const outcome = await addStockAsOwner(
    { headers: await headers(), env: process.env, db: getDb(), provider: createYahooProvider(), search: createYahooSearch(), currencies: createYahooCurrencyLookup() },
    result,
  );
  done(outcome.ok ? "added" : outcome.reason);
}

export async function removeStock(form: FormData): Promise<void> {
  const outcome = await removeStockAsOwner({ headers: await headers(), env: process.env, db: getDb() }, field(form, "symbol"));
  done(outcome.ok ? "removed" : outcome.reason);
}
