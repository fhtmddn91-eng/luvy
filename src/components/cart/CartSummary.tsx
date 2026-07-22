import Link from "next/link";
import { won } from "@/lib/format";

export function CartSummary({ subtotal, shippingFee }: { subtotal: number; shippingFee: number }) {
  const total = subtotal + shippingFee;
  return (
    <div className="rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
      <h2 className="text-[16px] font-bold text-ink">주문 요약</h2>
      <dl className="mt-4 space-y-2 text-[14px]">
        <div className="flex justify-between text-ink-soft">
          <dt>상품 합계</dt>
          <dd>{won(subtotal)}</dd>
        </div>
        <div className="flex justify-between text-ink-soft">
          <dt>배송비</dt>
          <dd>{shippingFee === 0 ? "무료" : won(shippingFee)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex justify-between border-t border-line pt-4">
        <span className="text-[15px] font-bold text-ink">결제 예정 금액</span>
        <span className="text-[20px] font-extrabold text-brand-600">{won(total)}</span>
      </div>
      <Link
        href="/checkout"
        className="mt-6 flex h-12 items-center justify-center rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600"
      >
        주문하기
      </Link>
    </div>
  );
}
