"use client";

import { useActionState } from "react";
import { placeOrder, type OrderState } from "@/lib/actions/order";
import { AuthField } from "@/components/auth/AuthField";
import { SubmitButton } from "@/components/auth/SubmitButton";

export function CheckoutForm() {
  const [state, action] = useActionState<OrderState, FormData>(placeOrder, {});
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
      <h2 className="text-[16px] font-bold text-ink">배송 정보</h2>
      <AuthField label="수령인" name="recipient" />
      <AuthField label="연락처" name="phone" placeholder="010-0000-0000" autoComplete="tel" />
      <AuthField label="주소" name="address" placeholder="도로명 주소 + 상세주소" />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-soft">배송 메모 (선택)</span>
        <textarea
          name="memo"
          rows={2}
          className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none"
          placeholder="예) 부재 시 문 앞에 놓아주세요"
        />
      </label>
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <p className="rounded-xl bg-brand-50 px-4 py-3 text-[12px] text-brand-600">
        실제 결제(PG) 연동은 데모 범위에서 제외되며, ‘주문 접수’로 처리됩니다.
      </p>
      <SubmitButton>주문 접수하기</SubmitButton>
    </form>
  );
}
