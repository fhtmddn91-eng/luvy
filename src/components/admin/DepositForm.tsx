"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { confirmDeposit, type DepositFormState } from "@/lib/actions/admin-orders";
import { errorCls, fieldCls, helpCls, labelCls } from "@/components/ui/form";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 w-full bg-brand-500 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      {pending ? "확인 중…" : "입금 확인 → 배송준비"}
    </button>
  );
}

/**
 * 무통장 입금 확인.
 *
 * 금액을 미리 채워두지 않는다 — 주문 총액을 그대로 두면 운영자가 통장을 안 보고
 * 그냥 누르게 된다. 부분입금·초과입금이 기록으로 남으려면 실제로 찍힌 숫자를
 * 옮겨 적어야 한다.
 */
export function DepositForm({ orderId, total }: { orderId: string; total: number }) {
  const bound = confirmDeposit.bind(null, orderId);
  const [state, formAction] = useActionState<DepositFormState, FormData>(bound, {});

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="depositorName" className={labelCls}>
          입금자명 (통장 표기)
        </label>
        <input
          id="depositorName"
          name="depositorName"
          defaultValue={state.values?.depositorName ?? ""}
          autoComplete="off"
          placeholder="예) 주식회사러비"
          className={fieldCls}
        />
        <p className={helpCls}>주문자와 다른 이름으로 들어오는 경우가 많습니다. 통장에 찍힌 그대로 적어주세요.</p>
      </div>

      <div>
        <label htmlFor="depositAmount" className={labelCls}>
          실제 입금액
        </label>
        <input
          id="depositAmount"
          name="depositAmount"
          defaultValue={state.values?.depositAmount ?? ""}
          inputMode="numeric"
          autoComplete="off"
          placeholder={`주문 총액 ${total.toLocaleString("ko-KR")}원`}
          className={fieldCls}
        />
        <p className={helpCls}>
          총액과 달라도 저장됩니다. 부족·초과는 기록으로 남습니다.
        </p>
      </div>

      {state.error && <p className={errorCls}>{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
