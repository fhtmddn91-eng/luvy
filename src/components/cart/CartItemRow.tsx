"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductThumb } from "@/components/product/ProductThumb";
import { QtyStepper } from "@/components/product/QtyStepper";
import { updateCartQty, removeCartItem } from "@/lib/actions/cart";
import { won } from "@/lib/format";
import { resolveUnitPrice, type Tier } from "@/lib/pricing";

export interface CartRowData {
  id: string;
  productId: string;
  name: string;
  brand: string;
  quantity: number;
  moq: number;
  tiers: Tier[];
}

export function CartItemRow({ item }: { item: CartRowData }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const unit = resolveUnitPrice(item.tiers, item.quantity);

  const changeQty = (v: number) =>
    startTransition(async () => {
      await updateCartQty(item.id, v);
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      await removeCartItem(item.id);
      router.refresh();
    });

  return (
    <div className={`flex items-center gap-4 border-b border-line py-4 ${pending ? "opacity-60" : ""}`}>
      <ProductThumb id={item.productId} brand={item.brand} className="h-20 w-20 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-brand-500">{item.brand}</p>
        <p className="truncate text-[14px] font-medium text-ink">{item.name}</p>
        <p className="mt-1 text-[12px] text-muted">적용 단가 {won(unit)}</p>
      </div>
      <QtyStepper value={item.quantity} min={item.moq} onChange={changeQty} />
      <div className="w-28 text-right text-[15px] font-bold text-ink">{won(unit * item.quantity)}</div>
      <button type="button" onClick={remove} className="text-[13px] text-muted hover:text-brand-600">
        삭제
      </button>
    </div>
  );
}
