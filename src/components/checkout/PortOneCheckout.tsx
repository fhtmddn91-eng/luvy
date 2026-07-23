"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as PortOne from "@portone/browser-sdk/v2";
import { createPendingOrder } from "@/lib/actions/order";
import { AuthField } from "@/components/auth/AuthField";

const PAY_METHODS = [
  { value: "CARD", label: "신용카드" },
  { value: "TRANSFER", label: "실시간 계좌이체" },
  { value: "EASY_PAY", label: "간편결제" },
] as const;

interface Props {
  storeId: string;
  channelKey: string;
  customerName: string;
  customerEmail: string;
}

export function PortOneCheckout({ storeId, channelKey, customerName, customerEmail }: Props) {
  const [payMethod, setPayMethod] = useState<(typeof PAY_METHODS)[number]["value"]>("CARD");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const phone = String(formData.get("phone") ?? "");

    startTransition(async () => {
      const pending = await createPendingOrder(formData);
      if (!pending.ok) {
        setError(pending.error);
        return;
      }

      const response = await PortOne.requestPayment({
        storeId,
        channelKey,
        paymentId: pending.paymentId,
        orderName: pending.orderName,
        totalAmount: pending.amount,
        currency: "CURRENCY_KRW",
        payMethod,
        customer: { fullName: customerName, phoneNumber: phone, email: customerEmail },
      });

      // 리디렉션 없이 돌아온 경우: code가 있으면 실패/취소
      if (response?.code) {
        setError(response.message ?? "결제가 취소되었거나 실패했습니다.");
        return;
      }

      const res = await fetch("/api/payments/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: pending.paymentId }),
      });
      const result = await res.json();
      if (result.ok) {
        router.push(`/checkout/complete?order=${result.orderId}`);
        router.refresh();
      } else {
        setError(result.reason ?? "결제 확인에 실패했습니다.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
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

      <div>
        <span className="mb-2 block text-[13px] font-semibold text-ink-soft">결제 수단</span>
        <div className="flex flex-wrap gap-2">
          {PAY_METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setPayMethod(m.value)}
              className={`rounded-pill px-4 py-2 text-[14px] font-semibold transition-colors ${
                payMethod === m.value ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-600 hover:bg-brand-100"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[13px] font-medium text-brand-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
      >
        {pending ? "결제 진행 중…" : "결제하기"}
      </button>
    </form>
  );
}
