// Toss Invest Open API client — OAuth2 client-credentials token management
// plus batched live-price lookups. Plain JS / zero dependencies on purpose:
// this runs directly with `node server.js` on the VM, no build step needed.

const BASE_URL = "https://openapi.tossinvest.com";
const TOKEN_URL = `${BASE_URL}/oauth2/token`;
const PRICES_URL = `${BASE_URL}/api/v1/prices`;

// /api/v1/prices caps `symbols` at 200 per call.
const SYMBOLS_PER_REQUEST = 200;
// Refresh the access token slightly before it actually expires so an
// in-flight request never gets a token that dies mid-call.
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export class TossInvestError extends Error {}

function getCredentials() {
  const clientId = process.env.TOSS_CLIENT_ID;
  const clientSecret = process.env.TOSS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new TossInvestError(
      "TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 환경변수가 설정되어 있지 않습니다."
    );
  }
  return { clientId, clientSecret };
}

async function readErrorMessage(res) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    return body.error?.message ?? body.error?.code ?? (text || res.statusText);
  } catch {
    return text || res.statusText;
  }
}

let cachedToken = null; // { accessToken, expiresAt }
let tokenFetch = null;

async function requestNewToken() {
  const { clientId, clientSecret } = getCredentials();
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new TossInvestError("토스증권 API에 연결할 수 없습니다.");
  }

  if (!res.ok) {
    throw new TossInvestError(
      `토스증권 토큰 발급 실패 (${res.status}): ${await readErrorMessage(res)}`
    );
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new TossInvestError("토스증권 토큰 응답에 access_token이 없습니다.");
  }

  cachedToken = {
    accessToken: json.access_token,
    expiresAt:
      Date.now() + (json.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_BUFFER_MS,
  };
  return cachedToken.accessToken;
}

// A client only ever has one valid access token at a time (issuing a new
// one invalidates the previous one), so concurrent callers must share a
// single in-flight token request instead of each requesting their own.
async function getAccessToken() {
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

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function callWithAuth(url, isRetry = false) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && !isRetry) {
    cachedToken = null;
    return callWithAuth(url, true);
  }
  return res;
}

// Toss has no push/WebSocket feed — "real-time" here means this gets called
// on a fixed interval (see server.js) rather than the app polling Toss
// directly.
export async function fetchLivePrices(codes) {
  if (codes.length === 0) return new Map();

  const batches = await Promise.all(
    chunk(codes, SYMBOLS_PER_REQUEST).map(async (batch) => {
      const url = `${PRICES_URL}?symbols=${batch.join(",")}`;
      const res = await callWithAuth(url);
      if (!res.ok) {
        throw new TossInvestError(
          `토스증권 현재가 조회 실패 (${res.status}): ${await readErrorMessage(res)}`
        );
      }
      const json = await res.json();
      return json.result ?? [];
    })
  );

  const result = new Map();
  for (const items of batches) {
    for (const item of items) {
      result.set(String(item.symbol), {
        price: Number(item.lastPrice),
        timestamp: String(item.timestamp),
      });
    }
  }
  return result;
}
