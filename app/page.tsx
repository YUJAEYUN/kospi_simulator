"use client";

import { useCallback, useMemo, useState } from "react";
import IndexCard from "@/components/IndexCard";
import OverridesPanel from "@/components/OverridesPanel";
import StockExplorer from "@/components/StockExplorer";
import type { KospiSnapshot } from "@/lib/kospi";
import { simulateIndex } from "@/lib/kospi";
import { formatBasDt, formatTime } from "@/lib/format";

export default function Home() {
  const [snapshot, setSnapshot] = useState<KospiSnapshot | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kospi", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "데이터를 불러오지 못했습니다.");
      }
      setSnapshot(data as KospiSnapshot);
      setOverrides({});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다."
      );
    } finally {
      setLoading(false);
    }
  }, []);

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

  const simulatedIndex = useMemo(() => {
    if (!snapshot) return 0;
    return simulateIndex(snapshot.stocks, overrides, snapshot.baseMarketCap)
      .simulatedIndex;
  }, [snapshot, overrides]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[#191F28]">
            코스피 지수 시뮬레이터
          </h1>
          <p className="truncate text-xs text-[#8B95A1]">
            {snapshot
              ? `${formatBasDt(snapshot.basDt)} 종가 기준 · ${formatTime(snapshot.fetchedAt)} 갱신`
              : "종목 가격을 바꿔 코스피 변화를 확인해보세요"}
          </p>
        </div>
        <button
          onClick={fetchSnapshot}
          disabled={loading}
          className="shrink-0 rounded-full bg-[#3182F6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:opacity-60"
        >
          {loading ? "불러오는 중…" : snapshot ? "최신화" : "데이터 불러오기"}
        </button>
      </header>

      {error && (
        <div className="rounded-xl bg-[#FEF0F0] px-4 py-3 text-sm text-[#F04452]">
          {error}
        </div>
      )}

      {!snapshot && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-[#8B95A1]">
            상단 버튼을 눌러 전일 종가 기준 코스피 데이터를 불러오세요.
          </p>
        </div>
      )}

      {snapshot && (
        <>
          <IndexCard
            actualIndex={snapshot.actualIndex}
            simulatedIndex={simulatedIndex}
            basDt={snapshot.basDt}
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
          />
        </>
      )}

      <p className="px-1 pb-4 text-center text-[11px] leading-relaxed text-[#8B95A1]">
        본 서비스는 전일 종가 데이터를 기반으로 한 교육·시뮬레이션 목적의
        도구이며, 실제 코스피 지수와 다를 수 있습니다. 투자 판단의 근거로
        사용할 수 없습니다.
      </p>
    </div>
  );
}
