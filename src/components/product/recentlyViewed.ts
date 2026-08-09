/**
 * "최근 본 상품" 저장소 — 브라우저 localStorage.
 *
 * 서버에 남기지 않는 이유: 성인용품 열람 이력은 남기고 싶지 않은 정보이고,
 * 이 기능에 필요한 건 그 브라우저 안에서의 최근 목록뿐이다.
 */

export const RECENT_KEY = "luvy:recent";
export const RECENT_EVENT = "luvy:recent-change";
export const RECENT_MAX = 12;

export interface RecentItem {
  id: string;
  name: string;
  image: string;
}

function isItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.name === "string" && typeof o.image === "string";
}

export function readRecent(storage: Pick<Storage, "getItem">): RecentItem[] {
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // 옛 버전이나 손상된 값이 남아 있어도 화면이 깨지면 안 된다
    return Array.isArray(parsed) ? parsed.filter(isItem).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** 이미 있던 상품은 위로 끌어올린다(중복 없이 최신순). */
export function withVisit(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => r.id !== item.id)].slice(0, RECENT_MAX);
}
