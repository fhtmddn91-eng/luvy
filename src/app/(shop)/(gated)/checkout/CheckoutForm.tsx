"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { placeOrder, createNicePayOrder, type OrderState } from "@/lib/actions/order";
import { AuthField } from "@/components/auth/AuthField";
import { PhoneField } from "@/components/form/PhoneField";
import { AddressFields } from "@/components/checkout/AddressFields";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { PaymentMethodPicker } from "@/components/checkout/PaymentMethodPicker";
import { PointUseField } from "@/components/checkout/PointUseField";
import { openNicePayWindow } from "@/lib/nicepayClient";
import type { Availability } from "@/lib/paymentMethods";

export interface PointUseProps {
  balance: number;
  expiringSoon: number;
  subtotal: number;
  shippingFee: number;
  minUse: number;
  unit: number;
}

/**
 * 주문서. 결제 수단에 따라 제출 경로가 갈린다:
 *  · 무통장 — 서버 액션(placeOrder)으로 바로 접수
 *  · 카드   — createNicePayOrder 로 결제대기 주문을 만든 뒤 나이스페이 결제창을 연다.
 *            승인 결과는 나이스페이가 returnUrl 로 POST 하므로 이 화면으로 돌아오지 않는다.
 */
export function CheckoutForm({
  bankAccount,
  points,
  availability,
  payError,
}: {
  bankAccount: string;
  points: PointUseProps;
  availability: Availability;
  /** returnUrl 이 실패로 돌려보낸 사유 (?pay=failed&why=…) */
  payError?: string;
}) {
  const [state, action] = useActionState<OrderState, FormData>(placeOrder, {});
  // 첫 선택은 무통장 — 카드가 열려 있어도 기본은 예전과 같게 둔다
  const [method, setMethod] = useState<string>("BANK_TRANSFER");
  const [cardError, setCardError] = useState<string | null>(payError ?? null);
  const [cardBusy, startCard] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    if (fd.get("paymentMethod") !== "NICEPAY") return; // 무통장은 form action 이 처리한다
    e.preventDefault();
    setCardError(null);
    startCard(async () => {
      const r = await createNicePayOrder(fd);
      if (!r.ok) {
        setCardError(r.error);
        return;
      }
      if (r.paid) {
        router.push(`/checkout/complete?order=${r.orderId}`);
        router.refresh();
        return;
      }
      try {
        await openNicePayWindow(r.window, setCardError);
      } catch (err) {
        setCardError(err instanceof Error ? err.message : "결제창을 열지 못했습니다.");
      }
    });
  }

  const isCard = method === "NICEPAY";

  return (
    <form
      action={action}
      onSubmit={onSubmit}
      className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]"
    >
      <h2 className="text-[16px] font-bold text-ink">배송 정보</h2>
      <AuthField label="수령인" name="recipient" />
      <PhoneField label="연락처" />
      <AddressFields />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-soft">배송 메모 (선택)</span>
        <textarea
          name="memo"
          rows={2}
          className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none"
          placeholder="예) 부재 시 문 앞에 놓아주세요"
        />
      </label>
      <PointUseField {...points} />
      <div className="border-t border-line pt-4">
        <PaymentMethodPicker bankAccount={bankAccount} availability={availability} onChange={setMethod} />
      </div>

      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      {cardError && <p className="text-[13px] font-medium text-brand-600">{cardError}</p>}

      {isCard ? (
        <button
          type="submit"
          disabled={cardBusy}
          className="h-12 w-full rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {cardBusy ? "결제창 여는 중…" : "카드로 결제하기"}
        </button>
      ) : (
        <SubmitButton>주문 접수하기</SubmitButton>
      )}
    </form>
  );
}
