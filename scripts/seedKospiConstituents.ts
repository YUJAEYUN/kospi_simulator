// One-off / occasional maintenance script — NOT called by the deployed
// app. Toss's Open API has no "list every KOSPI stock" endpoint, so this
// script uses data.go.kr (the app's old data source) just once to produce
// a static snapshot of the constituent list, share counts, and the base
// market cap calibration constant. Re-run it whenever that needs updating:
//
//   npm run seed:kospi
//
// Requires DATA_GO_KR_SERVICE_KEY in .env.local (this script loads it
// itself since it runs outside the Next.js runtime). DART_API_KEY is
// optional but recommended — without it, common-stock share counts are
// left as data.go.kr's gross (treasury-share-inclusive) figures, which
// makes the derived index run a bit hotter than KRX's official one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchAllKospiStocks, fetchLatestMarketIndex } from "../lib/dataGoKr";
import { calibrateBaseMarketCap } from "../lib/kospi";
import { fetchCommonStockDistributed, fetchCorpCodeMap } from "../lib/dart";

const DART_CONCURRENCY = 8;
// 유통주식수(ex-treasury) can only be ≤ gross issued shares — it's a
// subtraction, never an addition. DART's structured extraction turns out to
// be unreliable for a chunk of smaller filers (unit typos, wrong scale in
// the source disclosure), occasionally returning a number many times larger
// than gross shares. Reject anything outside a plausible band rather than
// trust it blindly.
const MIN_PLAUSIBLE_RATIO = 0.5;
const MAX_PLAUSIBLE_RATIO = 1.02;

// KRX's own index calculation nets out treasury shares a company holds in
// itself; data.go.kr's "상장주식수" doesn't. DART's annual-report "유통주식수"
// (distb_stock_co) does, so we substitute it in for common-stock tickers
// wherever DART has usable data — this fixes the accounting convention, at
// the cost of the figure being up to a fiscal year old instead of ~1 week.
async function applyDartTreasuryAdjustment(
  stocks: { code: string; name: string; price: number; shares: number; marketCap: number }[]
) {
  const corpCodeMap = await fetchCorpCodeMap();
  const currentYear = new Date().getFullYear();
  const fiscalYearCandidates = [currentYear - 1, currentYear - 2, currentYear - 3];

  const commonStocks = stocks.filter((s) => corpCodeMap.has(s.code));

  let corrected = 0;
  let rejected = 0;
  const queue = [...commonStocks];
  async function worker() {
    while (queue.length > 0) {
      const s = queue.shift();
      if (!s) break;
      const corpCode = corpCodeMap.get(s.code)!;
      try {
        const distributed = await fetchCommonStockDistributed(
          corpCode,
          fiscalYearCandidates
        );
        if (distributed == null) continue;

        const ratio = distributed / s.shares;
        if (ratio < MIN_PLAUSIBLE_RATIO || ratio > MAX_PLAUSIBLE_RATIO) {
          rejected++;
          continue;
        }
        s.shares = distributed;
        s.marketCap = s.price * distributed;
        corrected++;
      } catch {
        // Leave this stock's data.go.kr-sourced shares as a fallback.
      }
    }
  }
  await Promise.all(
    Array.from({ length: DART_CONCURRENCY }, () => worker())
  );

  console.log(
    `DART: ${corrected}/${commonStocks.length} 보통주 종목에 자기주식 제외 유통주식수 반영, ` +
      `${rejected}개는 비정상 값(범위 밖)으로 판단해 기존 값 유지 ` +
      `(전체 ${stocks.length}개 중 ${commonStocks.length}개가 보통주로 매칭됨)`
  );
}

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value && !process.env[key]) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();

  const { basDt, clpr: actualIndex } = await fetchLatestMarketIndex();
  const stocks = await fetchAllKospiStocks(basDt);

  if (process.env.DART_API_KEY) {
    await applyDartTreasuryAdjustment(stocks);
  } else {
    console.log("DART_API_KEY 없음 — 자기주식 보정 건너뜀 (data.go.kr 발행주식수 그대로 사용)");
  }

  const { baseMarketCap, totalMarketCap } = calibrateBaseMarketCap(
    actualIndex,
    stocks
  );

  const seed = {
    basDt,
    actualIndex,
    baseMarketCap,
    totalMarketCap,
    generatedAt: new Date().toISOString(),
    stocks: stocks
      .map((s) => ({ code: s.code, name: s.name, shares: s.shares }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };

  const outPath = path.resolve(process.cwd(), "data/kospiConstituents.json");
  writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n");

  console.log(
    `Wrote ${seed.stocks.length} stocks to ${outPath} (basDt=${basDt}, baseMarketCap=${baseMarketCap})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
