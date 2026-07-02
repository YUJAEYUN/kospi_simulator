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

export async function fetchLatestMarketIndex(): Promise<{
  basDt: string;
  clpr: number;
}> {
  const today = new Date();
  for (let offset = 0; offset < MAX_DATE_LOOKBACK_DAYS; offset++) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    const basDt = formatBasDt(day);

    const clpr = await findKospiIndexOnDate(basDt);
    if (clpr != null) {
      return { basDt, clpr };
    }
  }

  throw new DataGoKrError(
    `최근 ${MAX_DATE_LOOKBACK_DAYS}일 내 코스피 지수 데이터를 찾을 수 없습니다.`
  );
}

// GetMarketIndexInfoService returns every KRX index for the date (KOSPI,
// KOSDAQ, sector/style indices, ...), not just KOSPI, so the composite
// index row can be well past the first page.
async function findKospiIndexOnDate(basDt: string): Promise<number | null> {
  let pageNo = 1;
  let totalCount = Infinity;

  while ((pageNo - 1) * PAGE_SIZE < totalCount && pageNo <= MAX_INDEX_PAGES) {
    const { items, totalCount: tc } = await callDataGoKr(MARKET_INDEX_URL, {
      basDt,
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
    });
    totalCount = tc;
    if (items.length === 0) break;

    const kospi = items.find(
      (item) => String(item.idxNm ?? "").trim() === "코스피"
    );
    if (kospi && kospi.clpr != null) {
      return Number(kospi.clpr);
    }
    pageNo++;
  }

  return null;
}

export async function fetchAllKospiStocks(basDt: string): Promise<StockRow[]> {
  const collected: Record<string, unknown>[] = [];
  let totalCount = Infinity;
  let pageNo = 1;

  while (collected.length < totalCount && pageNo <= MAX_PAGES) {
    const { items, totalCount: tc } = await callDataGoKr(STOCK_PRICE_URL, {
      basDt,
      numOfRows: String(PAGE_SIZE),
      pageNo: String(pageNo),
    });
    totalCount = tc;
    if (items.length === 0) break;
    collected.push(...items);
    pageNo++;
  }

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
