const STOCK_PRICE_URL =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";
const MARKET_INDEX_URL =
  "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex";

const PAGE_SIZE = 999;
const MAX_PAGES = 8;
const MAX_INDEX_PAGES = 5;
const MAX_DATE_LOOKBACK_DAYS = 10;

export class DataGoKrError extends Error {}

export interface StockRow {
  code: string;
  name: string;
  price: number;
  shares: number;
  marketCap: number;
}

function getServiceKey(): string {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    throw new DataGoKrError(
      "서버에 DATA_GO_KR_SERVICE_KEY 환경변수가 설정되어 있지 않습니다."
    );
  }
  return key;
}

function formatBasDt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function callDataGoKr(
  baseUrl: string,
  params: Record<string, string>
): Promise<{ totalCount: number; items: Record<string, unknown>[] }> {
  const url = new URL(baseUrl);
  url.searchParams.set("serviceKey", getServiceKey());
  url.searchParams.set("resultType", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch {
    throw new DataGoKrError("data.go.kr에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
  }

  const text = await res.text();

  // data.go.kr returns XML for auth/param errors even when resultType=json is requested.
  if (text.trim().startsWith("<")) {
    const authMsg = text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/)?.[1];
    const reasonCode = text.match(/<returnReasonCode>(.*?)<\/returnReasonCode>/)?.[1];
    const errMsg = text.match(/<errMsg>(.*?)<\/errMsg>/)?.[1];
    throw new DataGoKrError(
      `data.go.kr 요청 오류: ${authMsg ?? errMsg ?? "알 수 없는 오류"}${
        reasonCode ? ` (code ${reasonCode})` : ""
      }`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DataGoKrError("data.go.kr 응답을 해석할 수 없습니다.");
  }

  const response = (json as { response?: Record<string, unknown> })?.response;
  const header = response?.header as
    | { resultCode?: string; resultMsg?: string }
    | undefined;
  if (!header || header.resultCode !== "00") {
    throw new DataGoKrError(
      `data.go.kr 오류: ${header?.resultMsg ?? "알 수 없는 오류"} (${
        header?.resultCode ?? "?"
      })`
    );
  }

  const body = response?.body as
    | { totalCount?: number; items?: { item?: unknown } }
    | undefined;
  const totalCount = Number(body?.totalCount ?? 0);
  const rawItems = body?.items?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return { totalCount, items: items as Record<string, unknown>[] };
}

export interface IndexSearchAttempt {
  basDt: string;
  totalCount: number;
  found: boolean;
}

export async function fetchLatestMarketIndex(): Promise<{
  basDt: string;
  clpr: number;
  searchTrail: IndexSearchAttempt[];
}> {
  const today = new Date();
  const candidateDates = Array.from(
    { length: MAX_DATE_LOOKBACK_DAYS },
    (_, offset) => {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      return formatBasDt(day);
    }
  );

  // Query every candidate date at once instead of waiting on each one in
  // turn — a sequential 10-day lookback was the single biggest source of
  // latency when recent dates aren't published yet.
  const results = await Promise.all(
    candidateDates.map(async (basDt) => {
      const { clpr, totalCount } = await findKospiIndexOnDate(basDt);
      return { basDt, clpr, totalCount };
    })
  );

  const searchTrail: IndexSearchAttempt[] = results.map(
    ({ basDt, totalCount, clpr }) => ({
      basDt,
      totalCount,
      found: clpr != null,
    })
  );

  // `results` preserves candidateDates order (today first), so the first
  // match found is still the most recent available date.
  const match = results.find((r) => r.clpr != null);
  if (match) {
    return { basDt: match.basDt, clpr: match.clpr as number, searchTrail };
  }

  throw new DataGoKrError(
    `최근 ${MAX_DATE_LOOKBACK_DAYS}일 내 코스피 지수 데이터를 찾을 수 없습니다. ` +
      `(조회 내역: ${searchTrail
        .map((a) => `${a.basDt}=${a.totalCount}건`)
        .join(", ")})`
  );
}

// GetMarketIndexInfoService returns every KRX index for the date (KOSPI,
// KOSDAQ, sector/style indices, ...), not just KOSPI, so the composite
// index row can be well past the first page.
async function findKospiIndexOnDate(
  basDt: string
): Promise<{ clpr: number | null; totalCount: number }> {
  let pageNo = 1;
  let totalCount = Infinity;
  let sawTotalCount = 0;

  while ((pageNo - 1) * PAGE_SIZE < totalCount && pageNo <= MAX_INDEX_PAGES) {
    const { items, totalCount: tc } = await callDataGoKr(MARKET_INDEX_URL, {
      basDt,
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
    });
    totalCount = tc;
    sawTotalCount = tc;
    if (items.length === 0) break;

    const kospi = items.find(
      (item) => String(item.idxNm ?? "").trim() === "코스피"
    );
    if (kospi && kospi.clpr != null) {
      return { clpr: Number(kospi.clpr), totalCount: sawTotalCount };
    }
    pageNo++;
  }

  return { clpr: null, totalCount: sawTotalCount };
}

export async function fetchAllKospiStocks(basDt: string): Promise<StockRow[]> {
  // Page 1 tells us totalCount, so the remaining pages can be requested
  // concurrently instead of one-at-a-time.
  const first = await callDataGoKr(STOCK_PRICE_URL, {
    basDt,
    numOfRows: String(PAGE_SIZE),
    pageNo: "1",
  });

  const totalPages = Math.min(
    Math.ceil(first.totalCount / PAGE_SIZE) || 0,
    MAX_PAGES
  );

  const restPages = await Promise.all(
    Array.from({ length: Math.max(totalPages - 1, 0) }, (_, i) =>
      callDataGoKr(STOCK_PRICE_URL, {
        basDt,
        numOfRows: String(PAGE_SIZE),
        pageNo: String(i + 2),
      })
    )
  );

  const collected = [
    ...first.items,
    ...restPages.flatMap((page) => page.items),
  ];

  return collected
    .filter((item) => item.mrktCtg === "KOSPI")
    .map((item) => ({
      code: String(item.srtnCd ?? ""),
      name: String(item.itmsNm ?? ""),
      price: Number(item.clpr ?? 0),
      shares: Number(item.lstgStCnt ?? 0),
      marketCap: Number(item.mrktTotAmt ?? 0),
    }))
    .filter((stock) => stock.code && stock.shares > 0 && stock.marketCap > 0);
}
