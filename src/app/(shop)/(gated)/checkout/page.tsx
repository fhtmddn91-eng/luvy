import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CheckoutForm } from "./CheckoutForm";
import { won } from "@/lib/format";
import { shippingFor, type Tier } from "@/lib/pricing";
import { optionUnitPrice, memberOptionUnitPrice } from "@/lib/options";
import { getMemberDiscountBp } from "@/lib/memberDiscount";
import { discountLabel } from "@/lib/discount";
import { getShippingPolicy } from "@/lib/settings";
import { getBankAccount } from "@/lib/bankAccountInfo";
import { formatBankAccount } from "@/lib/bankAccount";
import { getPointPolicy } from "@/lib/settings";
import { pointSummary } from "@/lib/memberPoints";
import { isNicePayConfigured } from "@/lib/nicepay";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ pay?: string; why?: string }>;
}) {
  const user = await requireApprovedUser();
  // returnUrl 이 실패로 돌려보낸 경우 — 사유를 주문서 위에 보여준다 (장바구니는 그대로다)
  const sp = await searchParams;
  const payError =
    sp.pay === "failed" ? sp.why || "결제가 완료되지 않았습니다. 다시 시도해주세요."
    : sp.pay === "invalid" ? "결제 정보를 찾을 수 없습니다. 다시 시도해주세요."
    : undefined;
  const availability = { nicepay: isNicePayConfigured() };
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true, options: true } } },
  });
  if (items.length === 0) redirect("/cart");

  /*
   * 여기 금액은 buildOrderDraft(payments.ts)와 **같은 순수 함수·같은 할인율**로
   * 계산한다. 한쪽만 고치면 손님이 본 금액과 청구액이 갈린다.
   */
  const discountBp = await getMemberDiscountBp(user.id);
  const lines = items.map((it) => {
    const option = it.optionId ? it.product.options.find((o) => o.id === it.optionId) : undefined;
    const list = optionUnitPrice(option, it.product.priceTiers as Tier[], it.quantity);
    const unit = memberOptionUnitPrice(option, it.product.priceTiers as Tier[], it.quantity, discountBp);
    return {
      id: it.id,
      name: option ? `${it.product.name} (${option.name})` : it.product.name,
      quantity: it.quantity,
      lineTotal: unit * it.quantity,
      discountTotal: (list - unit) * it.quantity,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const discountAmount = lines.reduce((s, l) => s + l.discountTotal, 0);
  const shippingFee = shippingFor(subtotal, await getShippingPolicy());
  // 포인트 잔액은 만료 정리 뒤의 값 — 주문 액션이 같은 기준으로 다시 검사한다
  const [policy, summary] = await Promise.all([getPointPolicy(), pointSummary(user.id)]);
  const points = { balance: summary.balance, expiringSoon: summary.expiringSoon, subtotal, shippingFee, minUse: policy.minUse, unit: policy.unit };

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">주문/결제</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <CheckoutForm
          bankAccount={formatBankAccount(await getBankAccount())}
          points={points}
          availability={availability}
          payError={payError}
        />
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <h2 className="text-[16px] font-bold text-ink">주문 상품</h2>
          <ul className="mt-4 space-y-3 text-[14px]">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-ink-soft">{l.name} × {l.quantity}</span>
                <span className="shrink-0 font-semibold text-ink">{won(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[14px]">
            {/* 할인은 이미 상품 합계에 반영돼 있다 — 얼마를 아꼈는지만 따로 알린다 */}
            {discountAmount > 0 && (
              <div className="flex justify-between font-semibold text-brand-600">
                <dt>{discountLabel(discountBp)}</dt>
                <dd>−{won(discountAmount)}</dd>
              </div>
            )}
            <div className="flex justify-between text-ink-soft"><dt>상품 합계</dt><dd>{won(subtotal)}</dd></div>
            <div className="flex justify-between text-ink-soft"><dt>배송비</dt><dd>{shippingFee === 0 ? "무료" : won(shippingFee)}</dd></div>
          </dl>
          <div className="mt-4 flex justify-between border-t border-line pt-4">
            <span className="text-[15px] font-bold text-ink">합계</span>
            <span className="text-[20px] font-extrabold text-brand-600">{won(subtotal + shippingFee)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
