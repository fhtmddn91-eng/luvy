import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

type Seed = {
  name: string;
  brand: string;
  categorySlug: string;
  description: string;
  basePrice: number;
  tiers: { minQty: number; unitPrice: number }[];
};

// 각 상품은 MOQ(최소 티어 수량)부터 주문 가능. 수량이 커질수록 단가 하락.
const products: Seed[] = [
  { name: "실키 미스트 워터 젤 100ml", brand: "AQUALUX", categorySlug: "condom-lube", description: "수분 지속형 워터베이스 젤. 매장 회전율 높은 스테디셀러.", basePrice: 9000, tiers: [{ minQty: 10, unitPrice: 6500 }, { minQty: 30, unitPrice: 5900 }, { minQty: 60, unitPrice: 5400 }] },
  { name: "울트라 씬 콘돔 12P", brand: "AQUALUX", categorySlug: "condom-lube", description: "0.03 초박형 라텍스 콘돔 12개입.", basePrice: 12000, tiers: [{ minQty: 12, unitPrice: 8200 }, { minQty: 48, unitPrice: 7400 }] },
  { name: "소프트 터치 마사지 오일 200ml", brand: "VELVET", categorySlug: "massage-lotion", description: "저자극 아로마 마사지 오일. 무향/라벤더 2종.", basePrice: 15000, tiers: [{ minQty: 6, unitPrice: 10500 }, { minQty: 24, unitPrice: 9400 }] },
  { name: "웜 센세이션 워밍 로션", brand: "VELVET", categorySlug: "massage-lotion", description: "발열감 있는 워밍 타입 스킨 로션.", basePrice: 18000, tiers: [{ minQty: 6, unitPrice: 12800 }, { minQty: 24, unitPrice: 11500 }] },
  { name: "페탈 미니 진동기", brand: "BLOOM", categorySlug: "women", description: "10단계 진동, USB 충전, 생활방수. 여성용 베스트.", basePrice: 45000, tiers: [{ minQty: 5, unitPrice: 29000 }, { minQty: 20, unitPrice: 26000 }] },
  { name: "실리콘 케겔 트레이너 세트", brand: "BLOOM", categorySlug: "women", description: "3단계 무게 케겔볼 세트. 의료용 실리콘.", basePrice: 32000, tiers: [{ minQty: 5, unitPrice: 21000 }, { minQty: 20, unitPrice: 18500 }] },
  { name: "스태미나 링", brand: "IRONMAN", categorySlug: "men", description: "신축성 실리콘 링. 개별 위생 포장.", basePrice: 14000, tiers: [{ minQty: 10, unitPrice: 8800 }, { minQty: 40, unitPrice: 7900 }] },
  { name: "리얼필 스트로커", brand: "IRONMAN", categorySlug: "men", description: "이중구조 TPE 남성용 스트로커.", basePrice: 39000, tiers: [{ minQty: 5, unitPrice: 25000 }, { minQty: 20, unitPrice: 22500 }] },
  { name: "커플 리모트 세트", brand: "DUO", categorySlug: "couple-sm", description: "커플용 리모컨 진동 세트. 원거리 페어링.", basePrice: 68000, tiers: [{ minQty: 3, unitPrice: 44000 }, { minQty: 12, unitPrice: 40000 }] },
  { name: "새틴 블라인드 & 커프 세트", brand: "DUO", categorySlug: "couple-sm", description: "입문용 새틴 소재 안대+커프 세트.", basePrice: 22000, tiers: [{ minQty: 5, unitPrice: 14000 }, { minQty: 20, unitPrice: 12500 }] },
  { name: "젠틀 애널 트레이닝 키트", brand: "SMOOTH", categorySlug: "anal", description: "3단계 사이즈 실리콘 트레이닝 키트.", basePrice: 29000, tiers: [{ minQty: 5, unitPrice: 19000 }, { minQty: 20, unitPrice: 16800 }] },
  { name: "아이디어 방수 파우치", brand: "LUVY", categorySlug: "idea", description: "제품 보관용 지퍼 방수 파우치. 매장 사은품용.", basePrice: 4000, tiers: [{ minQty: 20, unitPrice: 1900 }, { minQty: 100, unitPrice: 1500 }] },
];

async function main() {
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.cartItem.deleteMany();
  await db.priceTier.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();

  for (const p of products) {
    await db.product.create({
      data: {
        name: p.name,
        brand: p.brand,
        categorySlug: p.categorySlug,
        description: p.description,
        basePrice: p.basePrice,
        priceTiers: { create: p.tiers },
      },
    });
  }

  await db.user.create({
    data: {
      email: "demo@luvy.co.kr",
      passwordHash: await bcrypt.hash("luvy1234", 10),
      companyName: "러비데모상사",
      businessNumber: "1234567890",
      ownerName: "김러비",
      phone: "010-1234-5678",
      status: "APPROVED",
    },
  });

  console.log("Seeded", products.length, "products + demo user (demo@luvy.co.kr / luvy1234)");
}

main().finally(() => db.$disconnect());
