"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setOrderStatus, type StatusFormState } from "@/lib/actions/admin-orders";
import { MANUAL_STATUSES, orderStatusLabel } from "@/lib/orderStatus";
import { errorCls, fieldCls } from "@/components/ui/form";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full bg-ink-deep text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      {pending ? "저장 중…" : "변경 저장"}
    </button>
  );
}

/**
 * 배송 상태 변경.
 *
 * 목록에 '취소'가 없다 — 취소는 재고 복원·환불이 함께 가야 해서 아래 전용 버튼으로만
 * 처리한다. 예전엔 이 드롭다운에 '취소'가 들어 있어 상태만 바뀌는 사고가 났다.
 * 서버(statusChangeRejection)도 같은 판단을 하므로 여기서 감추는 게 전부는 아니다.
 */
export function OrderStatusForm({ orderId, status }: { orderId: string; status: string }) {
  const bound = setOrderStatus.bind(null, orderId);
  const [state, formAction] = useActionState<StatusFormState, FormData>(bound, {});

  return (
    <form action={formAction} className="space-y-3">
      <select name="status" defaultValue={status} className={fieldCls} aria-label="주문 상태">
        {MANUAL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {orderStatusLabel(s)}
          </option>
        ))}
      </select>
      {state.error && <p className={errorCls}>{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
