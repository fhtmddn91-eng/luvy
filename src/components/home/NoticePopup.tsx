"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { NOTICE_POPUP_HIDE_KEY, isPopupHidden, nextLocalMidnight } from "@/lib/noticePopup";

export interface PopupNotice {
  id: string;
  tag: string;
  text: string;
  body: string;
}

/**
 * 메인 진입 공지 팝업.
 *
 * 하단 공지 스트립은 한 줄 요약이라 눈에 안 띈다는 운영자 요청(2026-09-05 요청서 4번).
 * 어드민에서 「메인 팝업으로 띄우기」를 켠 공지만 받아 화면 가운데 한 창에 세로로 나열한다.
 *
 * 「오늘 하루 보지 않기」는 브라우저 저장소에 다음 날 0시를 적는다. 저장소는 시크릿 창·
 * 차단 환경에서 읽기조차 throw 할 수 있어 전부 try/catch — 공지가 페이지를 죽이면 안 된다.
 * 서버 렌더 때는 저장값을 모르므로 닫힌 채로 그리고, 마운트 뒤에 판정해서 연다
 * (안 그러면 하루 끈 손님에게도 첫 프레임에 팝업이 번쩍한다).
 */
export function NoticePopup({ notices }: { notices: PopupNotice[] }) {
  const [open, setOpen] = useState(false);
  const [hideToday, setHideToday] = useState(false);

  useEffect(() => {
    if (notices.length === 0) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(NOTICE_POPUP_HIDE_KEY);
    } catch {
      stored = null;
    }
    if (!isPopupHidden(stored, new Date())) setOpen(true);
  }, [notices.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    // 뒤 페이지가 같이 스크롤되면 창 안 스크롤과 엉킨다
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (hideToday) {
      try {
        window.localStorage.setItem(NOTICE_POPUP_HIDE_KEY, String(nextLocalMidnight(new Date())));
      } catch {
        // 저장 못 해도 이번 방문에선 닫힌다
      }
    }
    setOpen(false);
  }

  if (!open || notices.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/55 p-4 backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-popup-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(84vh,760px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl bg-white shadow-[var(--shadow-soft)]"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <p id="notice-popup-title" className="text-[13px] font-bold tracking-[0.12em] text-brand-500">
            NOTICE
          </p>
          <button
            type="button"
            onClick={close}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-brand-50 hover:text-ink"
          >
            <Icon name="close" className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
          {notices.map((n) => (
            <article key={n.id} className="border-b border-line/70 py-5 last:border-0">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                  {n.tag}
                </span>
                <h2 className="text-[18px] font-extrabold leading-snug text-ink sm:text-[20px]">{n.text}</h2>
              </div>
              {n.body && (
                <div className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft">{n.body}</div>
              )}
              <Link
                href={`/support/notice/${n.id}`}
                onClick={close}
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-500 hover:text-brand-600"
              >
                자세히 보기
                <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
              </Link>
            </article>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-brand-50/40 px-6 py-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-[14px] text-ink-soft">
            <input
              type="checkbox"
              checked={hideToday}
              onChange={(e) => setHideToday(e.target.checked)}
              className="h-4 w-4 accent-brand-500"
            />
            오늘 하루 보지 않기
          </label>
          <button
            type="button"
            onClick={close}
            className="h-10 rounded-pill bg-ink px-6 text-[14px] font-bold text-white transition-colors hover:bg-brand-600"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
