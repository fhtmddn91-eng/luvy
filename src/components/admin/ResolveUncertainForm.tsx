"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { resolveUncertainPayment, type ResolveFormState } from "@/lib/actions/admin-orders";
import { errorCls } from "@/components/ui/form";

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full bg-ink-deep text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      {pending ? "나이스페이에 조회 중…" : "거래조회로 확정 · 정리"}
    </button>
  );
}

/**
 * 승인 불명 결제의 한 버튼 (2026-09-11 리뷰 #7).
 * 나이스페이에 물어봐서 승인돼 있으면 결제완료로, 승인이 없으면 취소·재고 복원으로.
 * 판단이 안 서면(금액 불일치·조회 실패) 아무것도 바꾸지 않고 이유만 보여 준다.
 */
export function ResolveUncertainForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<ResolveFormState, FormData>(
    resolveUncertainPayment.bind(null, orderId),
    {},
  );
  return (
    <form action={formAction} className="mt-3 space-y-2 border-t border-hairline pt-3">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        나이스페이에 이 주문의 거래를 조회해서 <b>승인돼 있으면 결제완료로 확정</b>하고,
        <b> 승인이 없으면 주문을 취소해 재고를 돌려놓습니다</b>. 판단이 안 서는 경우(금액 불일치 등)는
        아무것도 바꾸지 않고 이유를 보여 줍니다.
      </p>
      {state.error && <p className={errorCls}>{state.error}</p>}
      {state.ok && state.outcome && (
        <p className="text-[12.5px] font-semibold leading-relaxed text-ink-deep">{state.outcome}</p>
      )}
      {!state.ok && <Button />}
    </form>
  );
}
