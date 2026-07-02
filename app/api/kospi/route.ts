import { NextRequest, NextResponse } from "next/server";
import type { StockRow } from "@/lib/dataGoKr";
import { KOSPI_SEED } from "@/lib/kospiConstituents";
import type { KospiSnapshot } from "@/lib/kospi";
import { TossInvestError, fetchLivePrices } from "@/lib/tossInvest";

export const dynamic = "force-dynamic";

// How long a poll result is considered fresh before the next incoming
// request triggers another upstream call. Kept well under the frontend's
// own poll interval so every visitor's tick actually gets new data, while
// concurrent visitors within the window still share one upstream call.
const PRICE_TTL_MS = 2_500;

const codes = KOSPI_SEED.stocks.map((s) => s.code);
const namesByCode = new Map(KOSPI_SEED.stocks.map((s) => [s.code, s.name]));
// Share counts come only from the seed (data.go.kr + DART's treasury-share
// exclusion for common stock, see scripts/seedKospiConstituents.ts) — not
// refreshed from Toss at runtime, since Toss's `sharesOutstanding` is the
// gross (treasury-inclusive) figure and would undo that correction.
const sharesByCode = new Map<string, number>(
  KOSPI_SEED.stocks.map((s) => [s.code, s.shares])
);

const pricesByCode = new Map<string, { price: number; timestamp: string }>();
let pricesFetchedAt = 0;
let pricesInFlight: Promise<void> | null = null;

async function refreshPrices(): Promise<void> {
  if (Date.now() - pricesFetchedAt < PRICE_TTL_MS) return;
  if (!pricesInFlight) {
    pricesInFlight = fetchLivePrices(codes)
      .then((fresh) => {
        for (const [code, live] of fresh) {
          pricesByCode.set(code, live);
        }
        pricesFetchedAt = Date.now();
      })
      .finally(() => {
        pricesInFlight = null;
      });
  }
  await pricesInFlight;
}

// The index value itself is derived from live constituent prices rather
// than read from a Toss "KOSPI index" endpoint — Toss's Open API doesn't
// expose one, only per-stock quotes.
function buildSnapshot(): KospiSnapshot {
  const stocks: StockRow[] = [];
  for (const code of codes) {
    const price = pricesByCode.get(code)?.price;
    const shares = sharesByCode.get(code) ?? 0;
    if (!price || price <= 0 || shares <= 0) continue;
    stocks.push({
      code,
      name: namesByCode.get(code) ?? code,
      price,
      shares,
      marketCap: price * shares,
    });
  }

  const totalMarketCap = stocks.reduce((sum, s) => sum + s.marketCap, 0);
  const actualIndex =
    KOSPI_SEED.baseMarketCap > 0
      ? (totalMarketCap / KOSPI_SEED.baseMarketCap) * 100
      : 0;

  return {
    basDt: KOSPI_SEED.basDt,
    actualIndex,
    totalMarketCap,
    baseMarketCap: KOSPI_SEED.baseMarketCap,
    stocks,
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  if (codes.length === 0) {
    return NextResponse.json(
      {
        error:
          "코스피 구성종목 데이터가 없습니다. `npm run seed:kospi`를 먼저 실행해주세요.",
      },
      { status: 500 }
    );
  }

  if (request.nextUrl.searchParams.get("refresh") === "1") {
    pricesFetchedAt = 0;
  }

  try {
    await refreshPrices();
  } catch (error) {
    if (pricesByCode.size === 0) {
      const message =
        error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      const status = error instanceof TossInvestError ? 502 : 500;
      return NextResponse.json({ error: message }, { status });
    }
    // A previous poll already populated pricesByCode — keep serving that
    // instead of failing the request over one missed tick.
  }

  return NextResponse.json(buildSnapshot());
}
