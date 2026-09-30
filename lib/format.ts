export function formatIndex(value: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPrice(value: number): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

const EOK = 100_000_000; // 1억
const JO = 1_000_000_000_000; // 1조

export function formatWon(amount: number): string {
  const jo = Math.floor(amount / JO);
  const eok = Math.floor((amount % JO) / EOK);
  if (jo > 0) {
    return `${jo.toLocaleString("ko-KR")}조 ${eok.toLocaleString("ko-KR")}억원`;
  }
  return `${eok.toLocaleString("ko-KR")}억원`;
}

export function formatBasDt(basDt: string): string {
  if (basDt.length !== 8) return basDt;
  return `${basDt.slice(0, 4)}.${basDt.slice(4, 6)}.${basDt.slice(6, 8)}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSigned(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
