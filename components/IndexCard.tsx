"use client";

import { formatIndex, formatSigned } from "@/lib/format";

interface Props {
  actualIndex: number;
  simulatedIndex: number;
  overrideCount: number;
}

export default function IndexCard({
  actualIndex,
  simulatedIndex,
  overrideCount,
}: Props) {
  const diff = simulatedIndex - actualIndex;
  const pct = actualIndex !== 0 ? (diff / actualIndex) * 100 : 0;
  const isUp = diff > 0.005;
  const isDown = diff < -0.005;
  const color = isUp
    ? "text-[#F04452]"
    : isDown
      ? "text-[#3182F6]"
      : "text-[#8B95A1]";
  const arrow = isUp ? "▲" : isDown ? "▼" : "";

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <span className="text-sm font-medium text-[#8B95A1]">
        실시간 코스피
      </span>
      <div className="mt-1 text-2xl font-bold text-[#191F28]">
        {formatIndex(actualIndex)}
      </div>

      <div className="my-5 h-px bg-[#E5E8EB]" />

      <span className="text-sm font-semibold text-[#3182F6]">
        시뮬레이션 코스피
        {overrideCount > 0 ? ` · 종목 ${overrideCount}개 수정중` : ""}
      </span>
      <div className={`mt-1 text-4xl font-extrabold tracking-tight ${color}`}>
        {formatIndex(simulatedIndex)}
      </div>
      <div className={`mt-2 flex items-center gap-1 text-sm font-semibold ${color}`}>
        <span>{arrow}</span>
        <span>{formatSigned(diff)}p</span>
        <span>({formatSigned(pct)}%)</span>
      </div>
    </div>
  );
}
