"use client";

import { useActionState } from "react";
import { setMemberDiscount, type DiscountFormState } from "@/lib/actions/admin-members";
import { fieldCls, errorCls, helpCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";
import { formatDiscountPercent, MAX_DISCOUNT_BP } from "@/lib/discount";

/**
 * 이 거래처만의 할인율 (2026-09-08).
 *
 * 빈 칸이 "등급 기본값"이라는 사실을 **입력칸 자리표시자와 안내문 양쪽**에 적는다 —
 * 0 을 넣는 것과 비우는 것이 다른 뜻이라, 모르면 골드 거래처 할인을 0 으로 지운다.
 */
export function MemberDiscountForm({
  memberId,
  current,
  gradeName,
  gradeDiscountBp,
}: {
  memberId: string;
  /** 회원 개별 할인율(만분율). null 이면 등급 기본값을 따르는 중 */
  current: number | null;
  gradeName: string;
  gradeDiscountBp: number;
}) {
  const [state, formAction, pending] = useActionState<DiscountFormState, FormData>(
    setMemberDiscount.bind(null, memberId),
    {},
  );
  const gradePct = formatDiscountPercent(gradeDiscountBp);
  return (
    <form action={formAction} className="space-y-2.5">
      <div className="flex items-center gap-2">
        <input
          name="discountPercent"
          type="number"
          min={0}
          max={Number(formatDiscountPercent(MAX_DISCOUNT_BP))}
          step={0.01}
          inputMode="decimal"
          defaultValue={current === null ? "" : formatDiscountPercent(current)}
          placeholder={`비우면 등급 기본 ${gradePct}%`}
          aria-label="이 회원의 할인율 (%)"
          className={fieldCls}
        />
        <span className="shrink-0 text-[13px] font-semibold text-ink-deep">%</span>
      </div>
      <p className={helpCls}>
        지금 적용 중:{" "}
        <b>
          {current === null
            ? `${gradeName} 등급 기본 ${gradePct}%`
            : `이 거래처 지정 ${formatDiscountPercent(current)}%`}
        </b>
        <br />
        비워서 저장하면 등급 기본값({gradePct}%)을 따릅니다. <b>0 을 넣으면</b> 등급이 무엇이든
        이 거래처는 할인 없이 정가입니다. 다음 주문부터 적용되며, 이미 들어온 주문 금액은 바뀌지 않습니다.
      </p>
      {state.error && <p className={errorCls}>{state.error}</p>}
      {state.ok && !state.error && (
        <p className="text-[12.5px] font-semibold text-ink-deep">할인율이 저장되었습니다.</p>
      )}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "저장 중…" : "할인율 저장"}
      </button>
    </form>
  );
}
