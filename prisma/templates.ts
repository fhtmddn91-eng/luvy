/**
 * 템플릿 상품 5개 생성 스크립트.
 *
 * 실제 상품 정보가 확정되기 전, 어드민에서 내용을 채워 넣을 수 있는
 * "빈 양식" 상품을 만든다. 전부 HIDDEN 상태로 생성되므로 스토어에는
 * 노출되지 않으며, 어드민 → 상품 관리에서 내용 입력 후 "판매" 전환하면 된다.
 *
 * 실행: npm run db:templates  (이미 있으면 건너뜀 — 중복 생성 안 됨)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DESCRIPTION_TEMPLATE = `※ 이 상품은 입력용 템플릿입니다. 아래 항목을 실제 정보로 바꿔주세요.

■ 상품 소개
(핵심 특징 1~2문장. 예: 수분 지속형 워터베이스 젤로 매장 회전율이 높은 스테디셀러입니다.)

■ 상품 구성
(예: 본품 100ml × 1)

■ 소재 / 스펙
(예: 의료용 실리콘 / 크기 180×32mm / USB-C 충전 / 생활방수 IPX5)

■ 인증
(예: KC 인증 완료)

■ 배송 안내
평일 14시 이전 결제 시 당일 출고 · 무지 박스 포장

■ 판매자료
상세페이지·썸네일 원본 제공 — 파트너센터에서 요청`;

const templates = [
  { name: "[템플릿] 상품 1 — 여성용품", brand: "브랜드입력", categorySlug: "women", basePrice: 30000, tiers: [{ minQty: 5, unitPrice: 20000 }, { minQty: 20, unitPrice: 18000 }] },
  { name: "[템플릿] 상품 2 — 남성용품", brand: "브랜드입력", categorySlug: "men", basePrice: 30000, tiers: [{ minQty: 5, unitPrice: 20000 }, { minQty: 20, unitPrice: 18000 }] },
  { name: "[템플릿] 상품 3 — 커플/SM", brand: "브랜드입력", categorySlug: "couple-sm", basePrice: 30000, tiers: [{ minQty: 5, unitPrice: 20000 }, { minQty: 20, unitPrice: 18000 }] },
  { name: "[템플릿] 상품 4 — 마사지/로션", brand: "브랜드입력", categorySlug: "massage-lotion", basePrice: 15000, tiers: [{ minQty: 10, unitPrice: 9000 }, { minQty: 30, unitPrice: 8000 }] },
  { name: "[템플릿] 상품 5 — 콘돔/윤활제", brand: "브랜드입력", categorySlug: "condom-lube", basePrice: 12000, tiers: [{ minQty: 10, unitPrice: 7000 }, { minQty: 50, unitPrice: 6000 }] },
];

async function main() {
  let created = 0;
  for (const t of templates) {
    const exists = await db.product.findFirst({ where: { name: t.name } });
    if (exists) {
      console.log(`skip (이미 존재): ${t.name}`);
      continue;
    }
    await db.product.create({
      data: {
        name: t.name,
        brand: t.brand,
        categorySlug: t.categorySlug,
        description: DESCRIPTION_TEMPLATE,
        basePrice: t.basePrice,
        status: "HIDDEN", // 내용 입력 전까지 스토어 미노출
        priceTiers: { create: t.tiers },
      },
    });
    created++;
    console.log(`created: ${t.name}`);
  }
  console.log(`완료 — ${created}개 생성 (HIDDEN 상태, 어드민에서 수정 후 판매 전환)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
