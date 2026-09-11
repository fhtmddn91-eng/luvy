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

  /*
   * 현재 상태가 수동 목록에 없으면(결제완료 등) 그 상태를 첫 항목으로 넣는다.
   * 없으면 브라우저가 첫 항목 '접수됨'을 골라 보여 줘서, 아무것도 안 고치고 저장만
   * 눌러도 결제완료 → 접수됨이 제출됐다 — 그 주문은 매출 집계에서 빠진다(2026-09-11).
   * 서버는 같은 상태 제출을 변경 없음으로 받고, PAID → RECEIVED 는 거부한다.
   */
  const inList = (MANUAL_STATUSES as readonly string[]).includes(status);
  return (
    <form action={formAction} className="space-y-3">
      <select name="status" defaultValue={status} className={fieldCls} aria-label="주문 상태">
        {!inList && (
          <option value={status}>
            {orderStatusLabel(status)} (현재 — 그대로 두기)
          </option>
        )}
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
