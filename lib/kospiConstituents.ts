import seed from "@/data/kospiConstituents.json";

export interface ConstituentStock {
  code: string;
  name: string;
  shares: number;
}

export interface KospiSeed {
  basDt: string;
  actualIndex: number;
  baseMarketCap: number;
  totalMarketCap: number;
  generatedAt: string;
  stocks: ConstituentStock[];
}

// Snapshot of the KOSPI constituent list, share counts, and the base
// market cap calibration constant. Toss's Open API has no endpoint that
// lists "every KOSPI stock", so this file stands in for that — regenerate
// it with `npm run seed:kospi` (see scripts/seedKospiConstituents.ts)
// whenever the constituent set or share counts drift enough to matter.
export const KOSPI_SEED = seed as KospiSeed;
