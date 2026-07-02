import type { StockRow } from "./dataGoKr";

export interface KospiSnapshot {
  basDt: string;
  actualIndex: number;
  totalMarketCap: number;
  baseMarketCap: number;
  stocks: StockRow[];
  fetchedAt: string;
}

export function calibrateBaseMarketCap(
  actualIndex: number,
  stocks: StockRow[]
): { totalMarketCap: number; baseMarketCap: number } {
  const totalMarketCap = stocks.reduce((sum, s) => sum + s.marketCap, 0);
  const baseMarketCap = (totalMarketCap * 100) / actualIndex;
  return { totalMarketCap, baseMarketCap };
}

export function simulateIndex(
  stocks: StockRow[],
  overrides: Record<string, number>,
  baseMarketCap: number
): { simulatedIndex: number; simulatedTotalMarketCap: number } {
  let total = 0;
  for (const stock of stocks) {
    const overridePrice = overrides[stock.code];
    total +=
      overridePrice != null ? overridePrice * stock.shares : stock.marketCap;
  }
  return {
    simulatedTotalMarketCap: total,
    simulatedIndex: (total / baseMarketCap) * 100,
  };
}
