// « D'un coup d'œil » (US #21): one scrollable tile per instrument above the news of a brief, with
// its last close, its signed day variation and a 1 month curve drawn as an inline SVG on the server.
import type { Db } from "@/lib/db/client";
import { formatClose } from "@/lib/market/format";
import { getMarketTiles, type MarketTile } from "@/lib/market/tiles";

const CURVE_WIDTH = 120;
const CURVE_HEIGHT = 32;

/** SVG `points` of a curve scaled into the viewBox, oldest on the left; a flat curve sits in the middle. */
function curvePoints(curve: MarketTile["curve"]): string {
  const closes = curve.map((point) => point.close);
  const min = Math.min(...closes);
  const range = Math.max(...closes) - min;
  return curve
    .map((point, index) => {
      const x = (index / (curve.length - 1)) * CURVE_WIDTH;
      const y = range === 0 ? CURVE_HEIGHT / 2 : CURVE_HEIGHT - ((point.close - min) / range) * CURVE_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** « +1,25 % », « −0,80 % » (real minus sign), « 0,00 % » or « n/d », with its colour class. */
function variationLabel(variation: number | null): { text: string; className: string } {
  if (variation === null) return { text: "n/d", className: "text-neutral-500" };
  const number = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(variation));
  if (variation > 0) return { text: `+${number} %`, className: "text-green-700" };
  if (variation < 0) return { text: `−${number} %`, className: "text-red-700" };
  return { text: `${number} %`, className: "text-neutral-500" };
}

function Tile({ tile }: { tile: MarketTile }) {
  const variation = variationLabel(tile.dayVariation);
  return (
    <li className="w-40 shrink-0 rounded border border-neutral-200 p-3">
      <p className="truncate text-sm font-medium">{tile.name}</p>
      {tile.lastClose === null ? (
        <p className="mt-1 text-sm text-neutral-500">Pas encore de cours</p>
      ) : (
        <>
          <p className="mt-1 text-sm">{formatClose(tile.lastClose, tile.type, tile.currency)}</p>
          <p className={`text-sm font-semibold ${variation.className}`}>{variation.text}</p>
          {tile.curve.length >= 2 ? (
            <svg
              role="img"
              aria-label={`Évolution sur 1 mois de ${tile.name}`}
              viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
              className="mt-2 h-8 w-full"
              preserveAspectRatio="none"
            >
              <polyline points={curvePoints(tile.curve)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : null}
        </>
      )}
    </li>
  );
}

/** The tiles with the closes known the morning of `briefDate`. */
export function MarketTiles({ db, briefDate }: { db: Db; briefDate: string }) {
  return (
    <section aria-label="Marchés" className="mt-6">
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {getMarketTiles(db, briefDate).map((tile) => (
          <Tile key={tile.symbol} tile={tile} />
        ))}
      </ul>
    </section>
  );
}
