// Standalone, always-on backend for the KOSPI simulator's live prices.
//
// Why this exists: Vercel Functions don't have a static outbound IP, but
// Toss's Open API requires one to be allowlisted. This runs on a normal VM
// with a fixed IP instead, polls Toss on an interval, and hands the Next.js
// app a ready-made snapshot over a plain HTTP endpoint. As a side effect it
// also fixes the cold-start cache resets and duplicate-instance polling that
// come with running this logic inside Vercel's serverless functions.
//
// Run with: node src/server.js   (see backend/README.md for deployment)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchLivePrices } from "./toss.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2_500);
const BACKEND_SECRET = process.env.BACKEND_SECRET;

if (!BACKEND_SECRET) {
  console.error(
    "BACKEND_SECRET 환경변수가 설정되어 있지 않습니다 — 아무나 /snapshot을 호출할 수 있으면 안 되니, 반드시 설정하고 시작하세요."
  );
  process.exit(1);
}

const seedPath = path.resolve(__dirname, "../data/kospiConstituents.json");
const seed = JSON.parse(readFileSync(seedPath, "utf-8"));
const codes = seed.stocks.map((s) => s.code);
const namesByCode = new Map(seed.stocks.map((s) => [s.code, s.name]));
const sharesByCode = new Map(seed.stocks.map((s) => [s.code, s.shares]));

console.log(
  `${seed.stocks.length}개 종목 로드 완료 (baseMarketCap=${seed.baseMarketCap}). ${POLL_INTERVAL_MS}ms 주기로 폴링을 시작합니다.`
);

const pricesByCode = new Map();
let lastPollError = null;
let lastPollAt = 0;

async function poll() {
  try {
    const fresh = await fetchLivePrices(codes);
    for (const [code, live] of fresh) {
      pricesByCode.set(code, live);
    }
    lastPollError = null;
    lastPollAt = Date.now();
  } catch (error) {
    // Keep serving whatever prices we already have rather than crashing the
    // whole process over one missed tick.
    lastPollError =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("폴링 실패:", lastPollError);
  }
}

function buildSnapshot() {
  const stocks = [];
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
    seed.baseMarketCap > 0 ? (totalMarketCap / seed.baseMarketCap) * 100 : 0;

  return {
    basDt: seed.basDt,
    actualIndex,
    totalMarketCap,
    baseMarketCap: seed.baseMarketCap,
    stocks,
    fetchedAt: new Date().toISOString(),
  };
}

function isAuthorized(req) {
  const header = req.headers["authorization"];
  return header === `Bearer ${BACKEND_SECRET}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: pricesByCode.size > 0,
        pricesLoaded: pricesByCode.size,
        lastPollAt: lastPollAt ? new Date(lastPollAt).toISOString() : null,
        lastPollError,
      })
    );
    return;
  }

  if (url.pathname === "/snapshot") {
    if (!isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "인증 실패" }));
      return;
    }

    if (pricesByCode.size === 0) {
      const message = lastPollError
        ? `토스증권 API 오류: ${lastPollError}`
        : "아직 시세를 받아오지 못했습니다. 잠시 후 다시 시도해주세요.";
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(buildSnapshot()));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

poll();
setInterval(poll, POLL_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`백엔드가 포트 ${PORT}에서 대기 중입니다.`);
});
