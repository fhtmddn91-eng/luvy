"use client";

import { useState } from "react";
import { maxPointUse, validatePointUse, orderTotalAfterPoints } from "@/lib/points";

/**
 * 주문서 포인트 사용 칸 (2026-09-05 규칙).
 * 화면 검사는 안내용이고 서버가 같은 규칙으로 다시 검사한다(actions/order.ts).
 * 결제금액이 바로 바뀌어 보이도록 여기서 계산해 보여준다.
 */
export function PointUseField({
  balance,
  expiringSoon,
  subtotal,
  shippingFee,
  minUse,
  unit,
}: {
  balance: number;
  expiringSoon: number;
  subtotal: number;
  shippingFee: number;
  minUse: number;
  unit: number;
}) {
  const orderTotal = subtotal + shippingFee;
  const [value, setValue] = useState("0");
  const requested = value.trim() === "" ? 0 : Number(value.replace(/,/g, ""));
  const check = validatePointUse({ requested, balance, orderTotal, minUse, unit });
  const applied = check.ok ? check.amount : 0;
  const payable = orderTotalAfterPoints(subtotal, shippingFee, applied);
  const max = maxPointUse({ balance, orderTotal, minUse, unit });
  const fmt = (n: number) => n.toLocaleString("ko-KR");

  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-ink-soft">포인트 사용</span>
        <span className="text-[13px] text-muted">
          보유 <b className="text-ink">{fmt(balance)}P</b>
          {expiringSoon > 0 && <span className="ml-1.5 text-brand-600">30일 내 {fmt(expiringSoon)}P 소멸 예정</span>}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          name="pointsUsed"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
          disabled={balance < Math.max(minUse, unit)}
          aria-label="사용할 포인트"
          className="h-12 w-full rounded-xl border border-line bg-white px-4 text-[15px] text-ink focus:border-brand-400 focus:outline-none disabled:bg-canvas disabled:text-muted"
        />
        <button
          type="button"
          onClick={() => setValue(String(max))}
          disabled={max === 0}
          className="h-12 shrink-0 rounded-xl border border-line px-4 text-[13px] font-bold text-ink-soft transition-colors hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
        >
          전액 사용
        </button>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
        {minUse > 0 ? `${fmt(minUse)}P 이상부터, ` : ""}
        {unit > 1 ? `${fmt(unit)}P 단위로 ` : ""}배송비 포함 결제금액까지 쓸 수 있습니다. 포인트로 결제한 부분에는 적립되지 않습니다.
      </p>
      {!check.ok && requested > 0 && <p className="mt-1 text-[13px] font-medium text-brand-600">{check.error}</p>}
      <dl className="mt-3 space-y-1 rounded-xl bg-canvas px-4 py-3 text-[13.5px]">
        {applied > 0 && (
          <div className="flex justify-between text-ink-soft">
            <dt>포인트 사용</dt>
            <dd>−{fmt(applied)}원</dd>
          </div>
        )}
        <div className="flex justify-between font-bold text-ink">
          <dt>결제금액</dt>
          <dd className="text-brand-600">{fmt(payable)}원{payable === 0 && <span className="ml-1 text-[12px] font-semibold text-ink-soft">(포인트 전액 결제 — 입금 없이 바로 접수)</span>}</dd>
        </div>
      </dl>
    </div>
  );
}
