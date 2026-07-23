import { NextResponse } from "next/server";
import { Webhook } from "@portone/server-sdk";
import { db } from "@/lib/db";
import { finalizePayment } from "@/lib/payments";

export async function POST(req: Request) {
  const secret = process.env.PORTONE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: true, skipped: true });

  const raw = await req.text(); // 원문 그대로 검증 (JSON.parse 금지)
  let webhook;
  try {
    webhook = await Webhook.verify(secret, raw, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const paymentId = (webhook as { data?: { paymentId?: string } }).data?.paymentId;

  if (webhook.type === "Transaction.Paid" && paymentId) {
    await finalizePayment(paymentId);
  } else if (webhook.type === "Transaction.Cancelled" && paymentId) {
    const payment = await db.payment.findUnique({ where: { paymentId } });
    if (payment) {
      await db.$transaction([
        db.payment.update({ where: { paymentId }, data: { status: "CANCELED", canceledAt: new Date() } }),
        db.order.update({ where: { id: payment.orderId }, data: { status: "CANCELED" } }),
      ]);
    }
  }

  return NextResponse.json({ ok: true });
}
