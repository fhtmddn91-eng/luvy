/**
 * 메인 공지 팝업 「오늘 하루 보지 않기」 계산 (순수 함수 — 클라이언트에서 쓴다).
 *
 * 운영자 요청(2026-09-05 요청서 4번): 메인 하단 공지 스트립은 한 줄이라 눈에 안 띈다 —
 * 진입 시 큰 팝업으로 띄우되, 손님이 하루 동안 끌 수 있어야 매번 성가시지 않다.
 */

/** 브라우저 저장소 키 — 값은 "다시 보여줄 시각" 의 epoch ms */
export const NOTICE_POPUP_HIDE_KEY = "luvy.noticePopup.hideUntil";

/** 다음 날 0시(로컬) — "오늘 하루"의 끝 */
export function nextLocalMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
}

/** 저장값이 아직 지나지 않은 시각이면 숨김. 없거나 깨진 값은 보인다 */
export function isPopupHidden(stored: string | null | undefined, now: Date): boolean {
  const until = Number(stored);
  return Number.isFinite(until) && until > now.getTime();
}
