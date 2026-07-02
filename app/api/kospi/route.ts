import { NextResponse } from "next/server";
import {
  DataGoKrError,
  fetchAllKospiStocks,
  fetchLatestMarketIndex,
} from "@/lib/dataGoKr";
import { calibrateBaseMarketCap, type KospiSnapshot } from "@/lib/kospi";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { basDt, clpr: actualIndex } = await fetchLatestMarketIndex();
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

    const snapshot: KospiSnapshot = {
      basDt,
      actualIndex,
      totalMarketCap,
      baseMarketCap,
      stocks,
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(snapshot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    const status = error instanceof DataGoKrError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
