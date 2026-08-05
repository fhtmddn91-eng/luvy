"use client";

import { useState } from "react";
import { PAYMENT_METHODS } from "@/lib/paymentMethods";

/**
 * 결제 수단 선택.
 *
 * 아직 연동 안 된 PG는 숨기지 않고 '준비 중'으로 보여준다 — 어떤 결제가
 * 생길지 미리 알리되, 골랐다가 결제가 안 되는 사고는 막는다.
 * 선택값은 hidden input 으로 폼에 실려 서버에서 한 번 더 검증된다.
 */
export function PaymentMethodPicker({
  name = "paymentMethod",
  bankAccount,
}: {
  name?: string;
  /** 무통장입금 안내에 띄울 계좌 한 줄. 비어 있으면 계좌 없이 안내만 나간다 */
  bankAccount?: string;
}) {
  const first = PAYMENT_METHODS.find((m) => m.ready);
  const [selected, setSelected] = useState(first?.value ?? "");

  return (
    <div>
      <span className="mb-2 block text-[13px] font-semibold text-ink-soft">결제 수단</span>
      <input type="hidden" name={name} value={selected} />
      <div className="grid gap-2 sm:grid-cols-3">
        {PAYMENT_METHODS.map((m) => {
          const active = m.ready && selected === m.value;
          return (
            <button
              key={m.value}
              type="button"
              disabled={!m.ready}
              aria-pressed={active}
              onClick={() => setSelected(m.value)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                active
                  ? "border-brand-500 bg-brand-50"
                  : m.ready
                    ? "border-line bg-white hover:border-brand-300"
                    : "cursor-not-allowed border-line bg-canvas opacity-60"
              }`}
            >
              <span
                className={`block text-[14px] font-bold ${active ? "text-brand-600" : "text-ink"}`}
              >
                {m.label}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-tight text-muted">
                {m.ready ? m.hint : `${m.hint} · 준비 중`}
              </span>
            </button>
          );
        })}
      </div>
      {selected === "BANK_TRANSFER" && (
        <div className="mt-2 rounded-xl bg-brand-50 px-4 py-3 text-[12px] leading-relaxed text-brand-600">
          {bankAccount ? (
            <>
              <span className="block font-bold text-ink">{bankAccount}</span>
              <span className="mt-1 block">
                주문 후 위 계좌로 입금해주세요. 입금이 확인되면 발송이 시작됩니다.
              </span>
            </>
          ) : (
            // 계좌가 설정에서 비워진 경우 — 없는 계좌를 지어내지 않는다
            <span>주문 접수 후 입금 계좌를 안내해 드립니다. 입금이 확인되면 발송이 시작됩니다.</span>
          )}
        </div>
      )}
    </div>
  );
}
