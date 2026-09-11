import { won } from "@/lib/format";
import {
  paymentStatusLabel,
  paymentStatusTone,
  paymentStatusHint,
  paymentMethodName,
  parseNicePayReceipt,
  installmentLabel,
} from "@/lib/paymentDetail";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);

/**
 * 어드민 주문 상세의 결제 칸 (2026-09-11 리뷰 #6).
 *
 * 예전엔 상태·수단·채널·금액 네 줄이었고 상태 4개가 영어 코드로 떴다.
 * 거래번호(tid)는 나이스페이 관리자에서 그 결제를 찾는 유일한 열쇠라 반드시 보여야
 * 하고, 환불 실패·승인 불명은 **뭘 해야 하는지**가 화면에 있어야 한다.
 */
export function PaymentDetail({
  payment,
}: {
  payment: {
    status: string;
    method: string | null;
    channel: string;
    amount: number;
    paymentId: string;
    pgTxId: string | null;
    approvedAt: Date | null;
    canceledAt: Date | null;
    rawResponse: string | null;
  };
}) {
  const r = parseNicePayReceipt(payment.rawResponse);
  const hint = paymentStatusHint(payment.status);
  const card = [r.cardName, r.cardNum].filter(Boolean).join(" ");
  const partial = r.balanceAmt !== null && r.balanceAmt > 0 && r.balanceAmt < payment.amount;

  const Row = ({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) => (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className={`min-w-0 break-all text-right ${mono ? "font-display text-[12px] tracking-[0.03em]" : ""}`}>
        {children}
      </dd>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className={`px-2.5 py-1 text-[12px] font-bold ${paymentStatusTone(payment.status)}`}>
          {paymentStatusLabel(payment.status)}
        </span>
        <span className="text-[15px] font-extrabold text-ink-deep">{won(payment.amount)}</span>
      </div>

      {hint && (
        <p className="mb-3 border border-brand-500 bg-brand-50 px-3 py-2.5 text-[12px] leading-relaxed text-ink-deep">
          {hint}
        </p>
      )}

      {partial && (
        <p className="mb-3 border border-brand-500 bg-brand-50 px-3 py-2.5 text-[12px] leading-relaxed text-ink-deep">
          나이스페이 쪽 잔액이 <b>{won(r.balanceAmt!)}</b> 입니다 — 일부만 환불된 결제입니다. 주문 금액·재고를 사람이 맞춰야 합니다.
        </p>
      )}

      <dl className="space-y-1.5 text-[13px] text-ink-soft">
        <Row k="결제수단">
          {paymentMethodName(payment.method)}
          {card && <span className="ml-1.5 text-ink-deep">{card}</span>}
          {r.installment && payment.method?.toLowerCase() === "card" && (
            <span className="ml-1.5 text-muted">{installmentLabel(r.installment)}</span>
          )}
        </Row>
        {r.approveNo && <Row k="승인번호" mono>{r.approveNo}</Row>}
        {(r.paidAt ?? payment.approvedAt) && (
          <Row k="승인시각">{dateFmt(r.paidAt ?? payment.approvedAt!)}</Row>
        )}
        {(r.cancelledAt ?? payment.canceledAt) && (
          <Row k="취소시각">{dateFmt(r.cancelledAt ?? payment.canceledAt!)}</Row>
        )}
        {/* 나이스페이 관리자에서 이 결제를 찾는 열쇠 — 없으면 환불도 대사도 못 한다 */}
        <Row k="거래번호 (tid)" mono>{payment.pgTxId || <span className="text-muted">없음 (승인 전)</span>}</Row>
        <Row k="나이스페이 주문번호" mono>{payment.paymentId}</Row>
        <Row k="채널">{payment.channel === "nicepay" ? "나이스페이" : payment.channel}</Row>
        {r.receiptUrl && (
          <Row k="영수증">
            <a
              href={r.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ink-deep underline underline-offset-4 hover:opacity-70"
            >
              매출전표 보기 ↗
            </a>
          </Row>
        )}
      </dl>
    </div>
  );
}
