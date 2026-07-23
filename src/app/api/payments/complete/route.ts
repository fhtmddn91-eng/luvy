import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { finalizePayment } from "@/lib/payments";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const paymentId = body?.paymentId;
  if (typeof paymentId !== "string") {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const payment = await db.payment.findUnique({ where: { paymentId }, include: { order: true } });
  if (!payment || payment.order.userId !== user.id) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const result = await finalizePayment(paymentId);
  revalidatePath("/", "layout");
  return NextResponse.json(result, { status: result.ok ? 200 : 402 });
}
