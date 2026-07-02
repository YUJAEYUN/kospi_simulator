"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IndexCard from "@/components/IndexCard";
import OverridesPanel from "@/components/OverridesPanel";
import Spinner from "@/components/Spinner";
import StockExplorer from "@/components/StockExplorer";
import type { KospiSnapshot } from "@/lib/kospi";
import { simulateIndex } from "@/lib/kospi";
import { formatTimeWithSeconds } from "@/lib/format";

// Toss's Open API has no push/WebSocket feed, so "real-time" is achieved
// by polling the snapshot endpoint on an interval.
const LIVE_POLL_MS = 3_000;

export default function Home() {
  const [snapshot, setSnapshot] = useState<KospiSnapshot | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Off by default — polling only runs for visitors who explicitly opt in,
  // so a tab left open in the background doesn't quietly burn through the
  // hosting plan's request quota.
  const [liveMode, setLiveMode] = useState(false);
  const isFetchingRef = useRef(false);

  // `silent` distinguishes background live-price ticks (no spinner, keep
  // showing the last good snapshot on error) from the initial load (which
  // shows loading/error state). Overrides are never cleared here — they're
  // a hypothetical the user is applying on top of whatever the live price
  // is, so they should survive every tick.
  const fetchSnapshot = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch("/api/kospi", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "데이터를 불러오지 못했습니다.");
        }
        setSnapshot(data as KospiSnapshot);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다."
        );
      } finally {
        if (!silent) setLoading(false);
        isFetchingRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!liveMode) return;
    fetchSnapshot({ silent: true });
    const interval = setInterval(() => {
      fetchSnapshot({ silent: true });
    }, LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [liveMode, fetchSnapshot]);

  const handleChangeOverride = useCallback(
    (code: string, price: number | null) => {
      setOverrides((prev) => {
        const next = { ...prev };
        if (price == null) {
          delete next[code];
        } else {
          next[code] = price;
        }
        return next;
      });
    },
    []
  );

  const handleResetAll = useCallback(() => setOverrides({}), []);

  const { simulatedIndex, simulatedTotalMarketCap } = useMemo(() => {
    if (!snapshot) return { simulatedIndex: 0, simulatedTotalMarketCap: 0 };
    return simulateIndex(snapshot.stocks, overrides, snapshot.baseMarketCap);
  }, [snapshot, overrides]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-6">
      <header
        className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 bg-[#F2F4F6]/95 px-4 pb-3 backdrop-blur"
        style={{ paddingTop: "max(env(safe-area-inset-top), 1.25rem)" }}
      >
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[#191F28]">
            코스피 지수 시뮬레이터
          </h1>
          <p className="truncate text-xs text-[#8B95A1]">
            {snapshot ? (
              liveMode ? (
                <>
                  <span className="relative -top-px mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#F04452] align-middle" />
                  실시간 · {formatTimeWithSeconds(snapshot.fetchedAt)} 갱신
                </>
              ) : (
                `${formatTimeWithSeconds(snapshot.fetchedAt)} 기준 · 새로고침하면 최신화`
              )
            ) : (
              "종목 가격을 바꿔 코스피 변화를 확인해보세요"
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-medium text-[#191F28]">실시간</span>
          <button
            role="switch"
            aria-checked={liveMode}
            aria-label="실시간 갱신"
            onClick={() => setLiveMode((v) => !v)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              liveMode ? "bg-[#3182F6]" : "bg-[#D1D6DB]"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                liveMode ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 pt-4">
        {error && (
          <div className="rounded-xl bg-[#FEF0F0] px-4 py-3 text-sm text-[#F04452]">
            {error}
          </div>
        )}

        {!snapshot && loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-white p-10 text-center shadow-sm">
            <Spinner className="h-8 w-8 text-[#3182F6]" />
            <p className="text-sm text-[#8B95A1]">
              코스피 데이터를 불러오는 중입니다…
            </p>
          </div>
        )}

        {!snapshot && !loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-white p-10 text-center shadow-sm">
            <p className="text-sm text-[#8B95A1]">
              데이터를 불러오지 못했습니다. 새로고침하거나 실시간 스위치를
              켜서 다시 시도해주세요.
            </p>
          </div>
        )}

        {snapshot && (
          <>
            <IndexCard
              actualIndex={snapshot.actualIndex}
              simulatedIndex={simulatedIndex}
              overrideCount={Object.keys(overrides).length}
            />
            <OverridesPanel
              stocks={snapshot.stocks}
              overrides={overrides}
              onChangeOverride={handleChangeOverride}
              onResetAll={handleResetAll}
            />
            <StockExplorer
              stocks={snapshot.stocks}
              overrides={overrides}
              onChangeOverride={handleChangeOverride}
              totalMarketCap={simulatedTotalMarketCap}
            />
          </>
        )}
      </div>
    </div>
  );
}
