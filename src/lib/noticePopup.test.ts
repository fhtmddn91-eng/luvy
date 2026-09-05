/**
 * 메인 공지 팝업 「오늘 하루 보지 않기」 계산.
 *
 * 운영자 요청(2026-09-05 요청서 4번): 메인 하단 공지 스트립은 한 줄이라 눈에 안 띈다 —
 * 진입 시 큰 팝업으로 띄우되, 손님이 하루 동안 끌 수 있어야 매번 성가시지 않다.
 * 저장값은 브라우저 저장소에서 오므로 깨진 값은 "숨기지 않음"으로 본다.
 */
import { describe, it, expect } from "vitest";
import { nextLocalMidnight, isPopupHidden } from "./noticePopup";

describe("nextLocalMidnight — '오늘 하루'의 끝", () => {
  it("저녁 17:30 에 눌렀으면 다음 날 0시(로컬)까지", () => {
    const now = new Date(2026, 8, 5, 17, 30, 12);
    expect(new Date(nextLocalMidnight(now))).toEqual(new Date(2026, 8, 6, 0, 0, 0, 0));
  });

  it("정확히 0시에 눌렀어도 그날 하루 = 다음 날 0시", () => {
    const now = new Date(2026, 8, 5, 0, 0, 0, 0);
    expect(new Date(nextLocalMidnight(now))).toEqual(new Date(2026, 8, 6, 0, 0, 0, 0));
  });

  it("월말을 넘긴다", () => {
    const now = new Date(2026, 8, 30, 23, 59, 59);
    expect(new Date(nextLocalMidnight(now))).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
  });
});

describe("isPopupHidden — 저장값 판정", () => {
  const now = new Date(2026, 8, 5, 12, 0, 0);
  it("만료 시각이 아직 안 지났으면 숨김", () => {
    expect(isPopupHidden(String(now.getTime() + 60_000), now)).toBe(true);
  });
  it("지났으면 다시 보인다", () => {
    expect(isPopupHidden(String(now.getTime() - 1), now)).toBe(false);
  });
  it("없거나 깨진 값은 보인다 — 저장소가 막힌 환경에서도 공지는 나가야 한다", () => {
    expect(isPopupHidden(null, now)).toBe(false);
    expect(isPopupHidden(undefined, now)).toBe(false);
    expect(isPopupHidden("", now)).toBe(false);
    expect(isPopupHidden("abc", now)).toBe(false);
  });
});
