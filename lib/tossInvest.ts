const BASE_URL = "https://openapi.tossinvest.com";
const TOKEN_URL = `${BASE_URL}/oauth2/token`;
const PRICES_URL = `${BASE_URL}/api/v1/prices`;

// /api/v1/prices caps `symbols` at 200 per call.
const SYMBOLS_PER_REQUEST = 200;

// Refresh the access token slightly before it actually expires so an
// in-flight request never gets a token that dies mid-call.
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export class TossInvestError extends Error {}

interface TossErrorBody {
  error?: { code?: string; message?: string };
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TOSS_CLIENT_ID;
  const clientSecret = process.env.TOSS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new TossInvestError(
      "서버에 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 환경변수가 설정되어 있지 않습니다."
    );
  }
  return { clientId, clientSecret };
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as TossErrorBody;
    return body.error?.message ?? body.error?.code ?? (text || res.statusText);
  } catch {
    return text || res.statusText;
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let tokenFetch: Promise<string> | null = null;

async function requestNewToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
  } catch {
    throw new TossInvestError("토스증권 API에 연결할 수 없습니다.");
  }

  if (!res.ok) {
    throw new TossInvestError(
      `토스증권 토큰 발급 실패 (${res.status}): ${await readErrorMessage(res)}`
    );
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new TossInvestError("토스증권 토큰 응답에 access_token이 없습니다.");
  }

  const token: CachedToken = {
    accessToken: json.access_token,
    expiresAt:
      Date.now() + (json.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_BUFFER_MS,
  };
  cachedToken = token;
  return token.accessToken;
}

// A client only ever has one valid access token at a time (issuing a new
// one invalidates the previous one), so concurrent callers must share a
// single in-flight token request instead of each requesting their own.
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  if (!tokenFetch) {
    tokenFetch = requestNewToken().finally(() => {
      tokenFetch = null;
    });
  }
  return tokenFetch;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function callWithAuth(url: string, isRetry = false): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (res.status === 401 && !isRetry) {
    cachedToken = null;
    return callWithAuth(url, true);
  }
  return res;
}

async function fetchInBatches<T>(
  codes: string[],
  baseUrl: string,
  parseItem: (raw: Record<string, unknown>) => [string, T]
): Promise<Map<string, T>> {
  const result = new Map<string, T>();

  const batches = await Promise.all(
    chunk(codes, SYMBOLS_PER_REQUEST).map(async (batch) => {
      const url = `${baseUrl}?symbols=${batch.join(",")}`;
      const res = await callWithAuth(url);
      if (!res.ok) {
        throw new TossInvestError(
          `토스증권 API 요청 실패 (${res.status}): ${await readErrorMessage(res)}`
        );
      }
      const json = (await res.json()) as { result?: Record<string, unknown>[] };
      return json.result ?? [];
    })
  );

  for (const items of batches) {
    for (const item of items) {
      const [key, value] = parseItem(item);
      result.set(key, value);
    }
  }
  return result;
}

export interface LivePrice {
  price: number;
  timestamp: string;
}

// Toss has no push/WebSocket feed — "real-time" here means polling this
// snapshot endpoint on an interval (see app/api/kospi/route.ts).
export async function fetchLivePrices(
  codes: string[]
): Promise<Map<string, LivePrice>> {
  if (codes.length === 0) return new Map();
  return fetchInBatches(codes, PRICES_URL, (item) => [
    String(item.symbol),
    {
      price: Number(item.lastPrice),
      timestamp: String(item.timestamp),
    },
  ]);
}

