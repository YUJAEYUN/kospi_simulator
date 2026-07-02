// Naver Finance's own static asset CDN, not a documented public API — it
// could change or start 404ing without notice. Callers should treat a
// failed load as "no logo" (hide it) rather than a hard error.
export function stockLogoUrl(code: string): string {
  return `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${code}.svg`;
}
