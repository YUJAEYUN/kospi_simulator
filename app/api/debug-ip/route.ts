import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Temporary diagnostic route — Vercel Functions don't have a fixed outbound
// IP by default, so this calls a public IP-echo service to reveal whatever
// address this specific invocation is using. Hit it several times after
// deploying to see whether the IP is stable enough to allowlist with Toss.
// Safe to delete once you've registered an IP (or given up on this approach).
export async function GET() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
