"use client";

import { useActionState } from "react";
import { adjustMemberPoints, type PointFormState } from "@/lib/actions/admin-members";
import { fieldCls, labelCls, helpCls, errorCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

/**
 * 포인트 수동 지급/차감 (운영자 요청서 3번).
 * 금액은 양수만, 방향은 라디오로 — 마이너스 기호를 빠뜨려 차감이 지급으로 나가는 사고 방지.
 */
export function PointAdjustForm({ memberId }: { memberId: string }) {
  const [state, formAction, pending] = useActionState<PointFormState, FormData>(
    adjustMemberPoints.bind(null, memberId),
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <div className="flex gap-4 text-[13.5px] text-ink-deep">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="direction" value="add" defaultChecked className="h-4 w-4 accent-ink-deep" />
          지급
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="direction" value="subtract" className="h-4 w-4 accent-ink-deep" />
          차감
        </label>
      </div>
      <div>
        <label htmlFor="point-amount" className={labelCls}>포인트</label>
        <input
          id="point-amount"
          name="amount"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          placeholder="예: 5000"
          className={fieldCls}
        />
      </div>
      <div>
        <label htmlFor="point-reason" className={labelCls}>사유</label>
        <input
          id="point-reason"
          name="reason"
          maxLength={80}
          placeholder="예: 신규 거래 감사 포인트"
          className={fieldCls}
        />
        <p className={helpCls}>회원의 포인트 내역에 그대로 표시됩니다.</p>
      </div>
      {state.error && <p className={errorCls}>{state.error}</p>}
      {state.ok && !state.error && (
        <p className="text-[12.5px] font-semibold text-ink-deep">
          처리되었습니다. 잔액 {state.balance?.toLocaleString("ko-KR")}P
        </p>
      )}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending ? "처리 중…" : "포인트 반영"}
      </button>
    </form>
  );
}
