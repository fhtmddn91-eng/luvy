"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { cancelMyOrder, type CancelState } from "@/lib/actions/order";
import { CANCEL_REASONS } from "@/lib/orderStatus";
import { fieldCls, labelCls, errorCls } from "@/components/ui/form";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 flex-1 bg-ink-deep text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      {pending ? "취소 처리 중…" : "주문 취소 확정"}
    </button>
  );
}

export function CancelOrderForm({ orderId }: { orderId: string }) {
  const bound = cancelMyOrder.bind(null, orderId);
  const [state, formAction] = useActionState<CancelState, FormData>(bound, {});
  // 한 번의 클릭으로 주문이 사라지지 않도록 사유 입력 단계를 거친다
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          발송 전까지는 직접 취소할 수 있습니다. 발송 이후에는 고객센터로 문의해주세요.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 shrink-0 border border-hairline bg-white px-5 text-[13px] font-bold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
        >
          주문 취소
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="reason" className={labelCls}>
          취소 사유
        </label>
        <select id="reason" name="reason" defaultValue="" className={fieldCls}>
          <option value="">선택하세요</option>
          {CANCEL_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="detail" className={labelCls}>
          상세 내용 (선택)
        </label>
        <input
          id="detail"
          name="detail"
          maxLength={200}
          autoComplete="off"
          placeholder="예) 수량을 잘못 입력했습니다"
          className={fieldCls}
        />
      </div>

      <p className="text-[12px] leading-relaxed text-muted">
        취소하면 주문이 되돌아가지 않습니다. 같은 상품이 필요하시면 다시 주문해주세요.
        결제한 주문은 결제 수단으로 환불됩니다.
      </p>

      {state.error && <p className={errorCls}>{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 shrink-0 border border-hairline bg-white px-5 text-[13px] font-bold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
        >
          닫기
        </button>
        <ConfirmButton />
      </div>
    </form>
  );
}
