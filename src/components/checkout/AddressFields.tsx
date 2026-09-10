"use client";

import { useEffect, useRef, useState } from "react";
import { loadPostcodeSdk, type PostcodeResult } from "@/lib/postcodeClient";
import { pickAddress } from "@/lib/address";

/**
 * 배송 주소 입력 — 우편번호·기본주소는 **검색으로만** 채운다.
 *
 * 예전엔 주소가 한 칸이라 "청주" 두 글자로도 주문이 통과했다. 그대로 송장이
 * 나가면 배송이 안 된다. 그래서 두 칸을 읽기전용으로 두고 검색 결과만 들어가게
 * 한다 — 오타·미완성 주소가 원천적으로 막힌다.
 *
 * 상세주소만 직접 입력이다. 단독주택·상가는 동호수가 없어 **필수가 아니다**.
 *
 * 검색창은 팝업이 아니라 **레이어**로 연다. 팝업은 브라우저가 막으면 아무 일도
 * 일어나지 않은 것처럼 보인다.
 */
export function AddressFields() {
  const [postcode, setPostcode] = useState("");
  const [address, setAddress] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLInputElement>(null);

  // 레이어가 열리면 그 안에 검색창을 그린다 (닫으면 DOM 째 사라진다)
  useEffect(() => {
    if (!open || !layer.current) return;
    let 살아있음 = true;
    setBusy(true);
    loadPostcodeSdk()
      .then(() => {
        if (!살아있음 || !layer.current) return;
        setBusy(false);
        new window.daum!.Postcode({
          oncomplete: (data: PostcodeResult) => {
            setPostcode(data.zonecode);
            setAddress(pickAddress(data));
            setOpen(false);
            // 다음에 칠 곳은 상세주소다 — 손님이 다시 찾아 누르지 않게 커서를 옮긴다
            setTimeout(() => detail.current?.focus(), 0);
          },
          onclose: () => 살아있음 && setOpen(false),
          width: "100%",
          height: "100%",
        }).embed(layer.current, { autoClose: false });
      })
      .catch((e: Error) => {
        if (!살아있음) return;
        setBusy(false);
        setOpen(false);
        setError(e.message);
      });
    return () => {
      살아있음 = false;
    };
  }, [open]);

  const readOnlyCls =
    "h-12 w-full rounded-xl border border-line bg-cream px-4 text-[15px] text-ink placeholder:text-muted focus:outline-none";

  return (
    <div className="space-y-2.5">
      <span className="block text-[13px] font-semibold text-ink-soft">배송지</span>

      <div className="flex gap-2">
        {/*
         * readOnly 이지 disabled 가 아니다 — disabled 인 입력은 폼 전송에서 빠져
         * 서버가 우편번호를 아예 못 받는다.
         */}
        <input
          name="postcode"
          value={postcode}
          readOnly
          required
          placeholder="우편번호"
          aria-label="우편번호"
          onClick={() => setOpen(true)}
          className={`${readOnlyCls} w-32 cursor-pointer`}
        />
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="h-12 shrink-0 rounded-xl border border-ink px-5 text-[14px] font-bold text-ink transition-colors hover:bg-ink hover:text-white"
        >
          주소 찾기
        </button>
      </div>

      <input
        name="address"
        value={address}
        readOnly
        required
        placeholder="주소 찾기를 눌러주세요"
        aria-label="기본주소"
        onClick={() => setOpen(true)}
        className={`${readOnlyCls} cursor-pointer`}
      />

      <input
        ref={detail}
        name="addressDetail"
        defaultValue=""
        placeholder="상세주소 (동·호수, 없으면 비워두세요)"
        aria-label="상세주소"
        maxLength={100}
        className="h-12 w-full rounded-xl border border-line bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none"
      />

      {error && <p className="text-[12.5px] font-semibold text-brand-600">{error}</p>}

      {open && (
        <div className="rounded-xl border border-line bg-white p-2">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[12.5px] font-semibold text-ink-soft">
              {busy ? "주소 검색을 불러오는 중…" : "도로명·건물명·지번으로 검색하세요"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-2 text-[13px] font-bold text-muted hover:text-ink"
            >
              닫기
            </button>
          </div>
          <div ref={layer} className="h-[420px] w-full" />
        </div>
      )}
    </div>
  );
}
