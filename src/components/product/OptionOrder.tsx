"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QtyStepper } from "./QtyStepper";
import { addOptionsToCart } from "@/lib/actions/cart";
import { won } from "@/lib/format";
import { type Tier } from "@/lib/pricing";
import { optionUnitPrice, optionMaxQty, isOptionSoldOut, type OptionLite } from "@/lib/options";
import type { StockInfo } from "@/lib/stock";

/**
 * 옵션이 있는 상품의 주문 영역.
 *
 * 색상별로 몇 개씩 담는 게 도매의 기본이라, 옵션을 하나 고르게 하지 않고
 * 옵션마다 수량을 넣어 한 번에 담는다.
 */
export function OptionOrder({
  productId,
  options,
  tiers,
  moq,
  stockInfo,
}: {
  productId: string;
  options: OptionLite[];
  tiers: Tier[];
  moq: number;
  stockInfo: StockInfo;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const totalQty = useMemo(
    () => Object.values(qty).reduce((s, n) => s + n, 0),
    [qty],
  );
  // 단가는 옵션별로 다를 수 있고, 수량 구간은 "이 상품 전체 수량" 기준으로 본다
  const total = useMemo(
    () =>
      options.reduce((sum, o) => {
        const n = qty[o.id] ?? 0;
        return n > 0 ? sum + optionUnitPrice(o, tiers, totalQty) * n : sum;
      }, 0),
    [options, qty, tiers, totalQty],
  );

  const belowMoq = totalQty > 0 && totalQty < moq;

  const submit = (goCheckout: boolean) =>
    startTransition(async () => {
      await addOptionsToCart(
        productId,
        options.map((o) => ({ optionId: o.id, quantity: qty[o.id] ?? 0 })),
      );
      if (goCheckout) router.push("/checkout");
      else {
        setDone(true);
        setQty({});
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between bg-brand-50 px-4 py-2.5">
          <span className="text-[13px] font-bold text-brand-700">옵션 선택</span>
          <span className="text-[12px] text-brand-700">최소 주문 {moq}개</span>
        </div>
        <ul className="divide-y divide-line">
          {options.map((o) => {
            const soldOut = isOptionSoldOut(o, stockInfo);
            const max = optionMaxQty(o, stockInfo, 100_000);
            const unit = optionUnitPrice(o, tiers, Math.max(totalQty, moq));
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{o.name}</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {soldOut ? (
                      <span className="font-semibold text-ink-soft">품절</span>
                    ) : (
                      <>
                        {won(unit)}
                        {o.trackStock && ` · 재고 ${o.stock}개`}
                      </>
                    )}
                  </p>
                </div>
                {soldOut ? (
                  <span className="text-[13px] text-muted">—</span>
                ) : (
                  <QtyStepper
                    value={qty[o.id] ?? 0}
                    min={0}
                    max={max}
                    onChange={(v) => {
                      setQty((q) => ({ ...q, [o.id]: v }));
                      setDone(false);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-4">
        <span className="text-[14px] text-ink-soft">선택 {totalQty}개 · 합계</span>
        <span className="text-[22px] font-extrabold text-brand-600">{won(total)}</span>
      </div>

      {belowMoq && (
        <p className="text-[13px] font-semibold text-brand-600">
          최소 주문 수량은 {moq}개입니다. {moq - totalQty}개 더 담아주세요.
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending || totalQty === 0 || belowMoq}
          onClick={() => submit(false)}
          className="h-12 flex-1 rounded-pill border border-brand-300 bg-white text-[15px] font-bold text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-50"
        >
          {done ? "담김 ✓" : "장바구니 담기"}
        </button>
        <button
          type="button"
          disabled={pending || totalQty === 0 || belowMoq}
          onClick={() => submit(true)}
          className="h-12 flex-1 rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          바로 주문
        </button>
      </div>
    </div>
  );
}
