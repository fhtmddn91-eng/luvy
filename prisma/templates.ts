/**
 * 초기 상품 5종 등록 스크립트 (실제 상품명 반영, 내용 미완성 상태).
 *
 * 상품명만 확정된 단계이므로 브랜드·카테고리·도매가는 **임시값**이며,
 * 전부 HIDDEN(숨김)으로 생성되어 스토어에 노출되지 않는다.
 * 어드민 → 상품 관리에서 사진·가격·설명을 채운 뒤 "판매"로 전환한다.
 *
 * 실행: npm run db:templates   (같은 이름이 이미 있으면 건너뜀 — 중복 생성 안 됨)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** 이전 버전에서 만든 자리표시용 상품 (실제 상품명으로 대체됨) */
const OBSOLETE_PLACEHOLDERS = [
  "[템플릿] 상품 1 — 여성용품",
  "[템플릿] 상품 2 — 남성용품",
  "[템플릿] 상품 3 — 커플/SM",
  "[템플릿] 상품 4 — 마사지/로션",
  "[템플릿] 상품 5 — 콘돔/윤활제",
];

const descriptionFor = (name: string) => `※ 아직 내용이 채워지지 않은 상품입니다. 아래 항목을 실제 정보로 바꾸고 "판매"로 전환하세요.
※ 도매가·MOQ는 임시값이므로 반드시 실제 가격으로 수정해야 합니다.

■ 상품명
${name}

■ 상품 소개
(핵심 특징 1~2문장)

■ 상품 구성
(예: 본품 1 + 파우치 1)

■ 소재 / 사이즈 / 스펙
(예: 폴리에스터 / FREE / 색상 2종)

■ 인증
(예: KC 인증 완료 / 해당 없음)

■ 배송 안내
평일 14시 이전 결제 시 당일 출고 · 무지 박스 포장

■ 판매자료
상세페이지·썸네일 원본 제공 — 파트너센터에서 요청`;

/**
 * categorySlug / brand 는 상품명에서 추정한 값이므로 확인이 필요하다.
 * (코스튬 전용 카테고리가 없어 메이드복·바니걸은 couple-sm 으로 임시 배치)
 */
const gif = (n: number, gifs: number[]) => gifs.includes(n);

/**
 * 썸네일·상세 이미지는 저장소에 커밋된 정적 파일(public/products/)을 가리킨다.
 * 배포에 포함되므로 Volume 없이도 재배포에 유실되지 않고,
 * 운영 DB에는 이 스크립트가 경로만 넣어주면 된다.
 */
const products = [
  {
    name: "메이드복", brand: "브랜드입력", categorySlug: "couple-sm",
    image: "/products/maid/thumb.jpg",
    details: [1, 2, 3, 4].map((n) => `/products/maid/${n}.jpg`),
  },
  {
    name: "문라이트 박스 (레드핑크)", brand: "브랜드입력", categorySlug: "women",
    image: "/products/moonlight/thumb.gif",
    details: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(
      (n) => `/products/moonlight/${n}.${gif(n, [1, 4, 6]) ? "gif" : "jpg"}`,
    ),
  },
  {
    name: "블러쉬펀 우먼 인헐레이션 마젠타", brand: "블러쉬펀", categorySlug: "women",
    image: "/products/blushfun-magenta/thumb.png",
    details: ["/products/blushfun-magenta/1.jpg"],
  },
  {
    name: "블러쉬펀 피노나 퍼플", brand: "블러쉬펀", categorySlug: "women",
    image: "/products/blushfun-purple/thumb.png",
    details: ["/products/blushfun-purple/1.jpg"],
  },
  {
    name: "퍼플 바니걸", brand: "브랜드입력", categorySlug: "couple-sm",
    image: "/products/bunny/thumb.jpg",
    details: [1, 2, 3, 4].map((n) => `/products/bunny/${n}.jpg`),
  },
];

import { statSync } from "node:fs";
import path from "node:path";

/** 커밋된 정적 파일의 실제 바이트 수 (없으면 0 — 배포 환경에선 항상 존재) */
function bytesOf(url: string): number {
  try {
    return statSync(path.join(process.cwd(), "public", url)).size;
  } catch {
    return 0;
  }
}

// 임시 가격 (실제 도매가 확정 시 어드민에서 수정)
const PLACEHOLDER_BASE_PRICE = 30000;
const PLACEHOLDER_TIERS = [
  { minQty: 5, unitPrice: 20000 },
  { minQty: 20, unitPrice: 18000 },
];

async function main() {
  // 이전 자리표시 상품 정리 (숨김 상태인 것만)
  const removed = await db.product.deleteMany({
    where: { name: { in: OBSOLETE_PLACEHOLDERS }, status: "HIDDEN" },
  });
  if (removed.count > 0) {
    console.log(`이전 [템플릿] 자리표시 상품 ${removed.count}개 삭제`);
  }

  let created = 0;
  for (const p of products) {
    let product = await db.product.findFirst({ where: { name: p.name } });
    if (!product) {
      product = await db.product.create({
        data: {
          name: p.name,
          brand: p.brand,
          categorySlug: p.categorySlug,
          description: descriptionFor(p.name),
          basePrice: PLACEHOLDER_BASE_PRICE,
          status: "HIDDEN", // 내용 입력 전까지 스토어 미노출
          priceTiers: { create: PLACEHOLDER_TIERS },
        },
      });
      created++;
      console.log(`created: ${p.name}`);
    }

    // 썸네일·상세 이미지 연결 (이미 있으면 건드리지 않음 — 어드민 수정 보호)
    if (!product.image) {
      await db.product.update({ where: { id: product.id }, data: { image: p.image } });
      console.log(`  썸네일 연결: ${p.name}`);
    }
    const assetCount = await db.productAsset.count({ where: { productId: product.id } });
    if (assetCount === 0) {
      await db.productAsset.createMany({
        data: p.details.map((url, i) => ({
          productId: product!.id,
          kind: url.endsWith(".gif") ? "GIF" : "DETAIL",
          url,
          bytes: bytesOf(url),
          sortOrder: i,
        })),
      });
      console.log(`  상세 이미지 ${p.details.length}장 연결: ${p.name}`);
    }
  }
  console.log(`완료 — 신규 ${created}개 (HIDDEN 상태, 어드민에서 가격 입력 후 판매 전환)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
