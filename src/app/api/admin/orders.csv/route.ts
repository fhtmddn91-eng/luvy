import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { parseOrderFilter, orderWhere } from "@/lib/orderQuery";
import { orderStatusLabel } from "@/lib/orderStatus";
import { courierName } from "@/lib/shipping";
import { orderDiscountAmount, formatDiscountPercent } from "@/lib/discount";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(d);

/**
 * 주문 목록 CSV 다운로드 (엑셀용).
 * /api 는 미들웨어 밖이므로 여기서 직접 관리자 세션을 검사한다.
 */
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filter = parseOrderFilter({
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  const orders = await db.order.findMany({
    where: orderWhere(filter),
    include: { items: true, user: { select: { companyName: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 5000, // 안전 상한 — 이걸 넘으면 기간을 좁혀 받도록 안내
  });

  const rows: unknown[][] = [
    [
      "주문번호", "일시", "상태", "회원사", "이메일",
      // 택배사 엑셀 발주는 우편번호가 별도 칸이어야 붙는다
      "수령인", "연락처", "우편번호", "주소", "상세주소", "배송메모",
      // 할인 주문은 "상품합계"만으로 대사가 안 된다 — 정가와 깎인 금액을 함께 준다
      "상품", "품번", "총수량", "정가합계", "할인율", "할인금액", "상품합계", "배송비", "합계",
      "택배사", "운송장번호", "취소사유",
    ],
    ...orders.map((o) => [
      o.id.slice(0, 8).toUpperCase(),
      dateFmt(o.createdAt),
      orderStatusLabel(o.status),
      o.user.companyName,
      o.user.email,
      o.recipient,
      o.phone,
      o.postcode,
      o.address,
      o.addressDetail,
      o.memo ?? "",
      o.items.map((i) => `${i.name}${i.optionName ? ` (${i.optionName})` : ""} x${i.quantity}`).join(" / "),
      // 품번을 쓰지 않는 상품이 섞여 있어도 상품 순서와 자리가 어긋나지 않도록 빈 칸을 유지한다
      o.items.map((i) => i.sku).join(" / "),
      o.items.reduce((s, i) => s + i.quantity, 0),
      // 할인 도입 전 주문은 listPrice 가 0 이라 정가합계 = 상품합계 로 채운다
      o.subtotal + orderDiscountAmount(o.items),
      o.discountBp > 0 ? `${formatDiscountPercent(o.discountBp)}%` : "",
      orderDiscountAmount(o.items),
      o.subtotal,
      o.shippingFee,
      o.total,
      o.courier ? courierName(o.courier) : "",
      o.trackingNo,
      o.cancelReason,
    ]),
  ];

  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="luvy-orders-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
