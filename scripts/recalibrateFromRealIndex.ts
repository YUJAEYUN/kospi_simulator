// Recalibrates baseMarketCap against a real, current KOSPI value you read
// off an actual source (Toss app, Naver Finance, etc.) instead of
// data.go.kr's last available close, which can lag by much more than the
// usual one business day (see README "알려진 제약"). Run:
//
//   npm run recalibrate -- 7648.09
//
// Requires TOSS_CLIENT_ID/TOSS_CLIENT_SECRET in .env.local (this script
// loads it itself since it runs outside the Next.js runtime). Leaves the
// constituent list and share counts (including any DART treasury-share
// adjustment) untouched — only the calibration ratio changes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchLivePrices } from "../lib/tossInvest";

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

function formatToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

interface SeedStock {
  code: string;
  name: string;
  shares: number;
}

interface Seed {
  basDt: string;
  actualIndex: number;
  baseMarketCap: number;
  totalMarketCap: number;
  generatedAt: string;
  stocks: SeedStock[];
}

async function main() {
  loadEnvLocal();

  const realIndex = Number(process.argv[2]);
  if (!process.argv[2] || !Number.isFinite(realIndex) || realIndex <= 0) {
    console.error(
      "사용법: npm run recalibrate -- <실제_코스피_지수>  (예: npm run recalibrate -- 7648.09)"
    );
    process.exit(1);
  }

  const seedPath = path.resolve(process.cwd(), "data/kospiConstituents.json");
  const seed: Seed = JSON.parse(readFileSync(seedPath, "utf-8"));
  const codes = seed.stocks.map((s) => s.code);

  const livePrices = await fetchLivePrices(codes);

  let totalMarketCap = 0;
  let matched = 0;
  for (const s of seed.stocks) {
    const price = livePrices.get(s.code)?.price;
    if (!price) continue;
    totalMarketCap += price * s.shares;
    matched++;
  }

  const baseMarketCap = (totalMarketCap * 100) / realIndex;

  seed.basDt = formatToday();
  seed.actualIndex = realIndex;
  seed.totalMarketCap = totalMarketCap;
  seed.baseMarketCap = baseMarketCap;
  seed.generatedAt = new Date().toISOString();

  writeFileSync(seedPath, JSON.stringify(seed, null, 2) + "\n");

  console.log(
    `재보정 완료 (${matched}/${codes.length}개 종목 실시간가 반영): ` +
      `실제 지수 ${realIndex} 기준 baseMarketCap = ${baseMarketCap.toLocaleString()} ` +
      `(totalMarketCap = ${totalMarketCap.toLocaleString()})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
