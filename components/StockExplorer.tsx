"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StockRow } from "@/lib/dataGoKr";
import { formatPrice, formatWon } from "@/lib/format";
import { stockLogoUrl } from "@/lib/logo";

interface Props {
  stocks: StockRow[];
  overrides: Record<string, number>;
  onChangeOverride: (code: string, price: number | null) => void;
  totalMarketCap: number;
}

const PAGE_SIZE = 30;

export default function StockExplorer({
  stocks,
  overrides,
  onChangeOverride,
  totalMarketCap,
}: Props) {
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => [...stocks].sort((a, b) => b.marketCap - a.marketCap),
    [stocks]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.includes(q)
    );
  }, [sorted, query]);

  // Start a fresh page whenever the search term changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => v + PAGE_SIZE);
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="종목명 또는 종목코드로 검색"
        className="w-full rounded-xl bg-[#F2F4F6] px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#3182F6]"
      />

      <p className="mb-1 mt-3 text-xs text-[#8B95A1]">
        {query
          ? `검색 결과 ${filtered.length}개 중 ${visible.length}개 표시`
          : `시가총액순 전종목 ${filtered.length}개 중 ${visible.length}개 표시`}
      </p>
      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-[#8B95A1]">
          검색 결과가 없습니다.
        </p>
      )}

      <ul className="mt-2 divide-y divide-[#F2F4F6]">
        {visible.map((stock) => (
          <StockRowItem
            key={stock.code}
            stock={stock}
            overridePrice={overrides[stock.code] ?? null}
            onChange={(price) => onChangeOverride(stock.code, price)}
            totalMarketCap={totalMarketCap}
          />
        ))}
      </ul>

      {hasMore && (
        <div
          ref={sentinelRef}
          className="py-4 text-center text-xs text-[#8B95A1]"
        >
          더 불러오는 중…
        </div>
      )}
    </div>
  );
}

function StockRowItem({
  stock,
  overridePrice,
  onChange,
  totalMarketCap,
}: {
  stock: StockRow;
  overridePrice: number | null;
  onChange: (price: number | null) => void;
  totalMarketCap: number;
}) {
  const [draft, setDraft] = useState<string>(
    overridePrice != null ? String(overridePrice) : ""
  );
  const [editing, setEditing] = useState(false);

  // Briefly tints the row red/blue when a live poll moves this stock's
  // price, then fades back out — a visual cue that this row is actually
  // ticking, not just a static table.
  const prevPriceRef = useRef(stock.price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const prev = prevPriceRef.current;
    prevPriceRef.current = stock.price;
    if (stock.price === prev) return;
    setFlash(stock.price > prev ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [stock.price]);

  const isOverridden = overridePrice != null;
  const effectivePrice = overridePrice ?? stock.price;
  const effectiveMarketCap = isOverridden
    ? effectivePrice * stock.shares
    : stock.marketCap;
  const diffPct =
    stock.price !== 0
      ? ((effectivePrice - stock.price) / stock.price) * 100
      : 0;
  const weightPct =
    totalMarketCap !== 0 ? (effectiveMarketCap / totalMarketCap) * 100 : 0;

  function commit() {
    const parsed = Number(draft.replace(/,/g, ""));
    if (!draft || Number.isNaN(parsed) || parsed <= 0) {
      onChange(null);
      setDraft("");
    } else if (parsed === stock.price) {
      onChange(null);
    } else {
      onChange(parsed);
    }
    setEditing(false);
  }

  return (
    <li
      className={`flex items-center gap-3 rounded-lg py-3 transition-colors duration-700 ${
        flash === "up"
          ? "bg-[#FDEDED]"
          : flash === "down"
            ? "bg-[#EAF2FE]"
            : "bg-transparent"
      }`}
    >
      <StockLogo code={stock.code} name={stock.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#191F28]">
          {stock.name}
        </p>
        <p className="text-xs text-[#8B95A1]">
          {stock.code} · 시총{" "}
          {isOverridden ? (
            <>
              <span className="line-through">
                {formatWon(stock.marketCap)}
              </span>{" "}
              <span className="font-semibold text-[#1B64DA]">
                → {formatWon(effectiveMarketCap)}
              </span>
            </>
          ) : (
            formatWon(stock.marketCap)
          )}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {editing ? (
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(overridePrice != null ? String(overridePrice) : "");
                setEditing(false);
              }
            }}
            className="w-28 rounded-lg border border-[#3182F6] px-2 py-2 text-right text-base outline-none"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(String(effectivePrice));
              setEditing(true);
            }}
            className={`min-h-11 rounded-lg px-2 py-2 text-right text-sm font-semibold transition ${
              isOverridden
                ? "bg-[#E8F3FF] text-[#1B64DA]"
                : "text-[#191F28] hover:bg-[#F2F4F6]"
            }`}
          >
            {formatPrice(effectivePrice)}원
          </button>
        )}

        <p className="pr-2 text-[11px] text-[#8B95A1]">
          비중 {weightPct.toFixed(2)}%
        </p>

        {isOverridden && (
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={diffPct >= 0 ? "text-[#F04452]" : "text-[#3182F6]"}
            >
              {diffPct >= 0 ? "▲" : "▼"} {Math.abs(diffPct).toFixed(1)}%
            </span>
            <button
              onClick={() => {
                onChange(null);
                setDraft("");
              }}
              className="text-[#8B95A1] underline underline-offset-2"
            >
              초기화
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function StockLogo({ code, name }: { code: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F2F4F6] text-xs font-semibold text-[#8B95A1]">
        {name.slice(0, 1)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, per-stock icon; not worth Next's image optimizer
    <img
      src={stockLogoUrl(code)}
      alt=""
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-full bg-[#F2F4F6] object-contain p-1"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
