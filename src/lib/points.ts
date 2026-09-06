/**
 * 등급별 적립 포인트 계산 (운영자 요청서 3번, 2026-09-05) — 순수 함수.
 *
 * 적립률은 **만분율**(100 = 1%)로 저장한다. 0.5% 같은 소수 % 를 부동소수로 들고
 * 다니면 123,456원 × 0.005 처럼 원 단위에서 오차가 튀고, 회수할 때 액수가
 * 어긋난다. 정수로 곱하고 마지막에 한 번만 나눈다.
 */

/** 기준액 × 적립률(만분율), 원 미만 버림. 음수·깨진 값은 0 */
export function pointsFor(baseWon: number, rateBp: number): number {
  if (!Number.isFinite(baseWon) || !Number.isFinite(rateBp)) return 0;
  if (baseWon <= 0 || rateBp <= 0) return 0;
  return Math.floor((baseWon * rateBp) / 10_000);
}

/**
 * 설정 폼의 % 입력 → 만분율. 0~100, 소수 둘째 자리까지. 아니면 null.
 * 문자열로 자릿수를 검사한다 — 0.1+0.2 류의 부동소수 판정을 피하려고.
 */
export function parseRatePercent(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp <= 10_000 ? bp : null;
}

/** 만분율 → 화면 % ("1", "0.5", "2.75") */
export function formatRatePercent(rateBp: number): string {
  return String(rateBp / 100);
}
