import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { getBankAccount } from "@/lib/bankAccountInfo";
import { formatBankAccount } from "@/lib/bankAccount";

export default async function CheckoutCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const user = await requireUser();
  const { order: orderId } = await searchParams;
  if (!orderId) notFound();

  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.userId !== user.id) notFound();

  // 무통장입금은 여기서 계좌를 못 보면 입금할 방법이 없다 → 완료 화면에 크게 띄운다
  const bankAccount =
    order.paymentMethod === "BANK_TRANSFER" ? formatBankAccount(await getBankAccount()) : "";

  return (
    <div className="mx-auto max-w-[560px] px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-[32px]">
        🎀
      </div>
      <h1 className="text-[24px] font-extrabold text-ink">주문이 접수되었습니다</h1>
      <p className="mt-2 text-[14px] text-muted">주문번호 {order.id.slice(0, 8).toUpperCase()}</p>

      <div className="mt-8 rounded-2xl border border-line bg-white p-6 text-left shadow-[var(--shadow-soft)]">
        <ul className="space-y-2 text-[14px]">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-ink-soft">{i.name} × {i.quantity}</span>
              <span className="shrink-0 font-semibold text-ink">{won(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-line pt-4">
          <span className="font-bold text-ink">결제 예정 금액</span>
          <span className="text-[18px] font-extrabold text-brand-600">{won(order.total)}</span>
        </div>

        {bankAccount && (
          <div className="mt-4 rounded-xl bg-brand-50 px-4 py-4">
            <p className="text-[12px] font-bold text-brand-600">입금 계좌</p>
            <p className="mt-1 text-[15px] font-extrabold text-ink">{bankAccount}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              위 계좌로 <strong className="text-ink">{won(order.total)}</strong> 을(를) 입금해주세요.
              입금이 확인되면 발송이 시작됩니다.
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-center gap-3">
        <Link href="/orders" className="rounded-pill bg-brand-500 px-6 py-3 text-[14px] font-bold text-white hover:bg-brand-600">
          주문내역 보기
        </Link>
        <Link href="/" className="rounded-pill border border-brand-300 bg-white px-6 py-3 text-[14px] font-bold text-brand-600 hover:bg-brand-50">
          쇼핑 계속하기
        </Link>
      </div>
    </div>
  );
}
