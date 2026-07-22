"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QtyStepper } from "./QtyStepper";
import { addToCart } from "@/lib/actions/cart";
import { won } from "@/lib/format";
import { resolveUnitPrice, type Tier } from "@/lib/pricing";

export function AddToCart({ productId, tiers, moq }: { productId: string; tiers: Tier[]; moq: number }) {
  const [qty, setQty] = useState(moq);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const unit = resolveUnitPrice(tiers, qty);
  const total = unit * qty;

  const submit = (goCheckout: boolean) =>
    startTransition(async () => {
      await addToCart(productId, qty);
      if (goCheckout) router.push("/checkout");
      else {
        setDone(true);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
        <span className="text-[13px] text-ink-soft">주문 수량 (최소 {moq}개)</span>
        <QtyStepper value={qty} min={moq} onChange={(v) => { setQty(v); setDone(false); }} />
      </div>
      <div className="flex items-center justify-between border-t border-line pt-4">
        <span className="text-[14px] text-ink-soft">적용 단가 {won(unit)} · 합계</span>
        <span className="text-[22px] font-extrabold text-brand-600">{won(total)}</span>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(false)}
          className="h-12 flex-1 rounded-pill border border-brand-300 bg-white text-[15px] font-bold text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          {done ? "담김 ✓" : "장바구니 담기"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(true)}
          className="h-12 flex-1 rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          바로 주문
        </button>
      </div>
    </div>
  );
}
