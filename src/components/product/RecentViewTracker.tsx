"use client";

import { useEffect } from "react";
import {
  RECENT_EVENT,
  RECENT_KEY,
  readRecent,
  withVisit,
  type RecentItem,
} from "./recentlyViewed";

/** 상품 상세를 열면 "최근 본 상품"에 기록한다. 화면에는 아무것도 그리지 않는다. */
export function RecentViewTracker({ id, name, image }: RecentItem) {
  // 객체를 그대로 의존성에 두면 렌더마다 새 참조라 매번 다시 쓰게 된다
  useEffect(() => {
    try {
      const next = withVisit(readRecent(window.localStorage), { id, name, image });
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(RECENT_EVENT));
    } catch {
      // 사파리 프라이빗 모드 등 저장이 막힌 환경 — 기능만 조용히 빠진다
    }
  }, [id, name, image]);

  return null;
}
