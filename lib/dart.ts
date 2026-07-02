// DART(전자공시시스템) OpenAPI — used only by scripts/seedKospiConstituents.ts to
// pull each company's 유통주식수(자기주식 제외) so the index calibration matches
// KRX's own convention of excluding treasury shares from market cap. Not called
// by the deployed app at runtime.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE_URL = "https://opendart.fss.or.kr/api";

export class DartError extends Error {}

function getApiKey(): string {
  const key = process.env.DART_API_KEY;
  if (!key) {
    throw new DartError("DART_API_KEY 환경변수가 설정되어 있지 않습니다.");
  }
  return key;
}

// corpCode.xml only has one entry per legal entity (keyed by its common-stock
// ticker) — preferred-share tickers of the same company don't get their own
// entry, so this map only ever contains common-stock codes.
export async function fetchCorpCodeMap(): Promise<Map<string, string>> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}/corpCode.xml?crtfc_key=${key}`);
  if (!res.ok) {
    throw new DartError(`DART corpCode 다운로드 실패 (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  const dir = mkdtempSync(path.join(os.tmpdir(), "dart-corpcode-"));
  const zipPath = path.join(dir, "corpCode.zip");
  writeFileSync(zipPath, buffer);
  let xml: string;
  try {
    xml = execFileSync("unzip", ["-p", zipPath, "CORPCODE.xml"], {
      maxBuffer: 1024 * 1024 * 200,
    }).toString("utf-8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const map = new Map<string, string>();
  const blockRe = /<list>([\s\S]*?)<\/list>/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(xml))) {
    const corpCode = /<corp_code>(.*?)<\/corp_code>/.exec(block[1])?.[1];
    const stockCode = /<stock_code>(.*?)<\/stock_code>/.exec(block[1])?.[1]?.trim();
    if (corpCode && stockCode) {
      map.set(stockCode, corpCode);
    }
  }
  return map;
}

interface StockTotqyRow {
  se?: string;
  distb_stock_co?: string;
}

// Only the annual report (사업보고서) reliably has this breakdown filled in —
// quarterly/half-year filings return the field as "-" in practice. That means
// this value can lag by up to a fiscal year; it's fetched for correctness
// (matching KRX's ex-treasury convention), not freshness.
export async function fetchCommonStockDistributed(
  corpCode: string,
  fiscalYearCandidates: number[]
): Promise<number | null> {
  const key = getApiKey();
  for (const year of fiscalYearCandidates) {
    const url = `${BASE_URL}/stockTotqySttus.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = (await res.json()) as { status: string; list?: StockTotqyRow[] };
    if (json.status !== "000" || !json.list) continue;

    const commonRow = json.list.find((row) => row.se === "보통주");
    const value = commonRow?.distb_stock_co;
    if (value && value !== "-") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}
