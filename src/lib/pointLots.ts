/**
 * 포인트 묶음(lot) 계산 — 선입선출 소진·만료 (2026-09-05 규칙). 순수 함수.
 *
 * 양수 원장 행(적립·환급·지급) 하나가 묶음 하나다. 사용·차감·회수·만료는
 * **먼저 만료되는 묶음부터** 뺀다 — 손님에게 유리하고, "왜 이게 먼저 사라졌나"를
 * 설명할 수 있는 유일한 순서다.
 */

export interface Lot {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

/** 만료일 오름차순(없는 것은 뒤), 같으면 적립일 순 — 원본은 건드리지 않는다 */
export function sortLotsFifo<T extends Lot>(lots: T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiresAt && b.expiresAt) {
      const d = a.expiresAt.getTime() - b.expiresAt.getTime();
      if (d !== 0) return d;
    } else if (a.expiresAt) return -1;
    else if (b.expiresAt) return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export interface Allocation {
  takes: { id: string; take: number }[];
  /** 묶음을 다 써도 모자란 양. 사용은 거부, 회수는 사유에 적는다 */
  shortfall: number;
}

/** 요청량을 FIFO 순서로 묶음에서 뺀다 (계산만 — 저장은 호출자가) */
export function allocateFifo(lots: Lot[], amount: number): Allocation {
  const takes: Allocation["takes"] = [];
  let left = Math.max(0, Math.floor(amount));
  for (const lot of sortLotsFifo(lots)) {
    if (left === 0) break;
    if (lot.remaining <= 0) continue;
    const take = Math.min(lot.remaining, left);
    takes.push({ id: lot.id, take });
    left -= take;
  }
  return { takes, shortfall: left };
}

/**
 * 적립일 + 정책 개월. 0 이면 만료 없음.
 * 말일 넘김은 그 달 말일로 맞춘다 — 1/31 + 1개월이 3/3 이 되면 손님은 "왜 3월이냐" 한다.
 */
export function expiresAtFor(from: Date, months: number): Date | null {
  if (!Number.isFinite(months) || months <= 0) return null;
  const target = new Date(from.getFullYear(), from.getMonth() + months, 1, 0, 0, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(from.getDate(), lastDay), 0, 0, 0, 0);
}

/** 만료일이 지났고 남은 게 있는 묶음 */
export function dueLots<T extends Lot>(lots: T[], now: Date): T[] {
  return lots.filter((l) => l.remaining > 0 && l.expiresAt !== null && l.expiresAt.getTime() <= now.getTime());
}

/** now 이후 days 일 안에 만료되는 묶음의 남은 양 합계 (이미 만료된 것은 제외) */
export function expiringSoon(lots: Lot[], now: Date, days: number): number {
  const until = now.getTime() + days * 86_400_000;
  return lots
    .filter((l) => l.remaining > 0 && l.expiresAt !== null && l.expiresAt.getTime() > now.getTime() && l.expiresAt.getTime() <= until)
    .reduce((s, l) => s + l.remaining, 0);
}
