import { NextResponse } from "next/server";
import type { KospiSnapshot } from "@/lib/kospi";

export const dynamic = "force-dynamic";

// Toss requires an allowlisted static IP, which Vercel Functions don't have.
// So this route doesn't call Toss at all — it relays whatever the always-on
// backend (backend/, running on a VM with a fixed IP) already polled and
// cached. See backend/README.md for how that piece is deployed.
async function fetchFromBackend(): Promise<{ status: number; data: unknown }> {
  const backendUrl = process.env.BACKEND_URL;
  const backendSecret = process.env.BACKEND_SECRET;
  if (!backendUrl || !backendSecret) {
    return {
      status: 500,
      data: {
        error:
          "서버에 BACKEND_URL / BACKEND_SECRET 환경변수가 설정되어 있지 않습니다.",
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/snapshot`, {
      headers: { Authorization: `Bearer ${backendSecret}` },
      cache: "no-store",
    });
  } catch {
    return {
      status: 502,
      data: { error: "백엔드 서버에 연결할 수 없습니다." },
    };
  }

  const data = await res.json();
  return { status: res.status, data };
}

// Coalesces concurrent visitors landing within the same tick into a single
// backend call — the response body can only be read once, so this shares
// the already-parsed result rather than the raw Response.
let inFlight: ReturnType<typeof fetchFromBackend> | null = null;

export async function GET() {
  if (!inFlight) {
    inFlight = fetchFromBackend().finally(() => {
      inFlight = null;
    });
  }
  const { status, data } = await inFlight;
  return NextResponse.json(data as KospiSnapshot, { status });
}
