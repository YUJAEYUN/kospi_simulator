import { NextRequest, NextResponse } from "next/server";
import {
  DataGoKrError,
  fetchAllKospiStocks,
  fetchLatestMarketIndex,
  type IndexSearchAttempt,
} from "@/lib/dataGoKr";
import { calibrateBaseMarketCap, type KospiSnapshot } from "@/lib/kospi";

export const dynamic = "force-dynamic";

type CachedSnapshot = KospiSnapshot & { searchTrail: IndexSearchAttempt[] };

// In-memory, per-instance cache: once one visitor (or the "최신화" button)
// pulls fresh data, every other visitor gets served the same snapshot
// without hitting data.go.kr again. Resets whenever Vercel spins up a new
// serverless instance (cold start), not just on an explicit restart.
let cachedSnapshot: CachedSnapshot | null = null;
let inFlightFetch: Promise<CachedSnapshot> | null = null;

async function fetchFreshSnapshot(): Promise<CachedSnapshot> {
  const {
    basDt,
    clpr: actualIndex,
    searchTrail,
  } = await fetchLatestMarketIndex();
  const stocks = await fetchAllKospiStocks(basDt);

  if (stocks.length === 0) {
    throw new DataGoKrError(
      `${basDt} 기준 코스피 종목 데이터를 찾을 수 없습니다.`
    );
  }

  const { totalMarketCap, baseMarketCap } = calibrateBaseMarketCap(
    actualIndex,
    stocks
  );

  return {
    basDt,
    actualIndex,
    totalMarketCap,
    baseMarketCap,
    stocks,
    fetchedAt: new Date().toISOString(),
    searchTrail,
  };
}

// Coalesces concurrent misses (e.g. several visitors landing right after a
// cold start) into a single upstream call instead of one each.
async function getSnapshot(forceRefresh: boolean): Promise<CachedSnapshot> {
  if (!forceRefresh && cachedSnapshot) {
    return cachedSnapshot;
  }
  if (!inFlightFetch) {
    inFlightFetch = fetchFreshSnapshot()
      .then((snapshot) => {
        cachedSnapshot = snapshot;
        return snapshot;
      })
      .finally(() => {
        inFlightFetch = null;
      });
  }
  return inFlightFetch;
}

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const snapshot = await getSnapshot(forceRefresh);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    const status = error instanceof DataGoKrError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
