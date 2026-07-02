"use client";

import type { StockRow } from "@/lib/dataGoKr";
import { formatPrice } from "@/lib/format";

interface Props {
  stocks: StockRow[];
  overrides: Record<string, number>;
  onChangeOverride: (code: string, price: number | null) => void;
  onResetAll: () => void;
}

export default function OverridesPanel({
  stocks,
  overrides,
  onChangeOverride,
  onResetAll,
}: Props) {
  const codes = Object.keys(overrides);
  if (codes.length === 0) return null;

  const byCode = new Map(stocks.map((s) => [s.code, s]));

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#191F28]">
          적용된 가격 수정 ({codes.length})
        </h2>
        <button
          onClick={onResetAll}
          className="text-xs font-medium text-[#8B95A1] underline underline-offset-2"
        >
          전체 초기화
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {codes.map((code) => {
          const stock = byCode.get(code);
          if (!stock) return null;
          const price = overrides[code];
          return (
            <li
              key={code}
              className="flex items-center gap-2 rounded-full bg-[#E8F3FF] px-3 py-1.5 text-xs font-medium text-[#1B64DA]"
            >
              <span>{stock.name}</span>
              <span>{formatPrice(price)}원</span>
              <button
                onClick={() => onChangeOverride(code, null)}
                aria-label={`${stock.name} 수정 취소`}
                className="text-[#1B64DA]/60 hover:text-[#1B64DA]"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
