# LUVY 회원전용 B2B 커머스 필수기능 v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인한 B2B 사업자 회원이 카탈로그 탐색 → 상품 담기 → 주문 접수 → 주문 조회까지 실제 DB 위에서 완료할 수 있게 한다.

**Architecture:** Next.js App Router 서버 컴포넌트에서 Prisma로 직접 조회, 변경은 Server Actions로 처리하고 `revalidatePath`로 캐시 갱신. 인증은 bcrypt 해시 + jose 서명 JWT를 httpOnly 쿠키에 담는 경량 세션이며 `middleware.ts`가 회원전용 경로를 가드한다. 결제(PG)는 정책상 제외하고 주문 레코드 생성으로 시뮬레이션한다.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, Prisma + SQLite, bcryptjs, jose, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-luvy-member-commerce-design.md`

---

## File Structure

**신규 인프라**
- `.env` — `DATABASE_URL`, `AUTH_SECRET`
- `prisma/schema.prisma` — User/Product/PriceTier/CartItem/Order/OrderItem
- `prisma/seed.ts` — 상품·티어·데모 회원 시드
- `src/lib/db.ts` — Prisma 싱글턴
- `src/lib/format.ts` — `won(n)` 통화 포맷
- `src/lib/pricing.ts` — 티어 단가/ MOQ / 배송비 (순수 로직, 테스트)
- `src/lib/validation.ts` — 사업자번호 정규화/검증 (순수 로직, 테스트)
- `src/lib/auth.ts` — 해시/세션 토큰/쿠키/`getSession`/`requireUser`
- `src/middleware.ts` — 회원전용 경로 가드

**서버 액션**
- `src/lib/actions/auth.ts` — signup/login/logout
- `src/lib/actions/cart.ts` — addToCart/updateCartQty/removeCartItem/getCartCount
- `src/lib/actions/order.ts` — placeOrder

**컴포넌트**
- `src/components/product/ProductThumb.tsx` — 플레이스홀더 썸네일
- `src/components/product/ProductCard.tsx`, `ProductGrid.tsx`, `SortSelect.tsx`
- `src/components/product/PriceTierTable.tsx`, `QtyStepper.tsx`, `AddToCart.tsx`
- `src/components/cart/CartItemRow.tsx`, `CartSummary.tsx`
- `src/components/auth/AuthCard.tsx`, `AuthField.tsx`, `SubmitButton.tsx`
- `src/components/account/AuthMenu.tsx` — 헤더 로그인 상태

**페이지**
- `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`
- `src/app/category/[slug]/page.tsx`, `src/app/search/page.tsx`
- `src/app/products/[id]/page.tsx`
- `src/app/cart/page.tsx`
- `src/app/checkout/page.tsx`, `src/app/checkout/complete/page.tsx`
- `src/app/orders/page.tsx`, `src/app/orders/[id]/page.tsx`

**수정**
- `src/components/layout/Header.tsx` — cart 뱃지 서버연동 + AuthMenu
- `src/components/layout/UtilBar.tsx` — 로그인 상태 반영

---

## Phase 0 — 인프라

### Task 1: 의존성 설치 + Prisma 스키마 + 마이그레이션

**Files:**
- Create: `.env`, `prisma/schema.prisma`, `src/lib/db.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: 의존성 설치**

Run:
```bash
npm install @prisma/client bcryptjs jose
npm install -D prisma @types/bcryptjs vitest
```
Expected: 패키지 추가 후 `added N packages`.

- [ ] **Step 2: `.env` 작성**

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="dev-only-luvy-secret-change-in-prod-0123456789abcdef"
```

- [ ] **Step 3: `prisma/schema.prisma` 작성**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id             String     @id @default(cuid())
  email          String     @unique
  passwordHash   String
  companyName    String
  businessNumber String
  ownerName      String
  phone          String
  status         String     @default("APPROVED")
  createdAt      DateTime   @default(now())
  cartItems      CartItem[]
  orders         Order[]
}

model Product {
  id           String      @id @default(cuid())
  name         String
  brand        String
  categorySlug String
  description  String
  image        String      @default("")
  basePrice    Int
  status       String      @default("ACTIVE")
  createdAt    DateTime    @default(now())
  priceTiers   PriceTier[]
  cartItems    CartItem[]

  @@index([categorySlug])
}

model PriceTier {
  id        String  @id @default(cuid())
  productId String
  minQty    Int
  unitPrice Int
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
}

model CartItem {
  id        String  @id @default(cuid())
  userId    String
  productId String
  quantity  Int
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([userId, productId])
}

model Order {
  id          String      @id @default(cuid())
  userId      String
  status      String      @default("RECEIVED")
  recipient   String
  phone       String
  address     String
  memo        String?
  subtotal    Int
  shippingFee Int
  total       Int
  createdAt   DateTime    @default(now())
  user        User        @relation(fields: [userId], references: [id])
  items       OrderItem[]
}

model OrderItem {
  id        String @id @default(cuid())
  orderId   String
  productId String
  name      String
  brand     String
  unitPrice Int
  quantity  Int
  lineTotal Int
  order     Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 4: `package.json`에 scripts 추가**

`"scripts"` 안에 추가:
```json
"db:migrate": "prisma migrate dev",
"db:seed": "tsx prisma/seed.ts",
"test": "vitest run"
```
그리고 `"prisma"` 최상위 키 추가:
```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```
Run: `npm install -D tsx`
Expected: `added 1 package`.

- [ ] **Step 5: 마이그레이션 생성**

Run: `npx prisma migrate dev --name init`
Expected: `prisma/migrations/*/migration.sql` 생성, `dev.db` 생성, `✔ Generated Prisma Client`.

- [ ] **Step 6: `src/lib/db.ts` 작성**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 7: `.gitignore`에 dev.db 추가**

`.gitignore` 끝에 추가:
```
/prisma/dev.db
/prisma/dev.db-journal
```

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "chore: add prisma + sqlite schema and db client"
```

---

### Task 2: 시드 스크립트

**Files:**
- Create: `prisma/seed.ts`

- [ ] **Step 1: `prisma/seed.ts` 작성**

```typescript
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
```

- [ ] **Step 2: 시드 실행**

Run: `npm run db:seed`
Expected: `Seeded 12 products + demo user (demo@luvy.co.kr / luvy1234)`.

- [ ] **Step 3: 커밋**

```bash
git add prisma/seed.ts
git commit -m "feat: add database seed with products and demo member"
```

---

### Task 3: Vitest 설정

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: `vitest.config.ts` 작성**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: 실행 확인 (테스트 없음 상태)**

Run: `npm test`
Expected: `No test files found` (에러 아님) 또는 종료코드 0. 다음 태스크에서 첫 테스트 추가.

- [ ] **Step 3: 커밋**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config"
```

---

## Phase 1 — 순수 로직 (TDD)

### Task 4: 가격 로직 (pricing.ts)

**Files:**
- Create: `src/lib/pricing.ts`
- Test: `src/lib/pricing.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/pricing.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { resolveUnitPrice, getMoq, shippingFor, type Tier } from "./pricing";

const tiers: Tier[] = [
  { minQty: 10, unitPrice: 6500 },
  { minQty: 30, unitPrice: 5900 },
  { minQty: 60, unitPrice: 5400 },
];

describe("getMoq", () => {
  it("returns the smallest minQty", () => {
    expect(getMoq(tiers)).toBe(10);
  });
});

describe("resolveUnitPrice", () => {
  it("uses the highest tier whose minQty <= qty", () => {
    expect(resolveUnitPrice(tiers, 10)).toBe(6500);
    expect(resolveUnitPrice(tiers, 29)).toBe(6500);
    expect(resolveUnitPrice(tiers, 30)).toBe(5900);
    expect(resolveUnitPrice(tiers, 100)).toBe(5400);
  });
  it("falls back to the lowest tier price below MOQ", () => {
    expect(resolveUnitPrice(tiers, 1)).toBe(6500);
  });
});

describe("shippingFor", () => {
  it("charges 3000 below threshold, free at/above 100000", () => {
    expect(shippingFor(99999)).toBe(3000);
    expect(shippingFor(100000)).toBe(0);
  });
  it("is free for empty subtotal", () => {
    expect(shippingFor(0)).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/pricing.test.ts`
Expected: FAIL — `Cannot find module './pricing'`.

- [ ] **Step 3: 구현**

`src/lib/pricing.ts`:
```typescript
export type Tier = { minQty: number; unitPrice: number };

export const SHIPPING_FEE = 3000;
export const FREE_SHIPPING_THRESHOLD = 100_000;

/** 오름차순 정렬 사본. */
function sorted(tiers: Tier[]): Tier[] {
  return [...tiers].sort((a, b) => a.minQty - b.minQty);
}

export function getMoq(tiers: Tier[]): number {
  if (tiers.length === 0) return 1;
  return sorted(tiers)[0].minQty;
}

/** minQty <= qty 인 티어 중 가장 큰 minQty의 단가. 없으면 최저 티어 단가. */
export function resolveUnitPrice(tiers: Tier[], qty: number): number {
  const s = sorted(tiers);
  let price = s[0]?.unitPrice ?? 0;
  for (const t of s) {
    if (qty >= t.minQty) price = t.unitPrice;
  }
  return price;
}

export function shippingFor(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/pricing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/pricing.ts src/lib/pricing.test.ts
git commit -m "feat: add wholesale pricing logic with tests"
```

---

### Task 5: 사업자번호 검증 (validation.ts)

**Files:**
- Create: `src/lib/validation.ts`
- Test: `src/lib/validation.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/validation.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalizeBizNumber, isValidBizNumber, isValidEmail } from "./validation";

describe("normalizeBizNumber", () => {
  it("strips non-digits", () => {
    expect(normalizeBizNumber("123-45-67890")).toBe("1234567890");
    expect(normalizeBizNumber(" 123 45 67890 ")).toBe("1234567890");
  });
});

describe("isValidBizNumber", () => {
  it("accepts 10 digits", () => {
    expect(isValidBizNumber("123-45-67890")).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(isValidBizNumber("12345")).toBe(false);
    expect(isValidBizNumber("12345678901")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts a normal email", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
  });
  it("rejects malformed", () => {
    expect(isValidEmail("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/validation.test.ts`
Expected: FAIL — `Cannot find module './validation'`.

- [ ] **Step 3: 구현**

`src/lib/validation.ts`:
```typescript
export function normalizeBizNumber(input: string): string {
  return input.replace(/\D/g, "");
}

export function isValidBizNumber(input: string): boolean {
  return normalizeBizNumber(input).length === 10;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/validation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: add signup field validation with tests"
```

---

### Task 6: 통화 포맷 (format.ts)

**Files:**
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/format.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { won } from "./format";

describe("won", () => {
  it("formats with thousands separators and 원", () => {
    expect(won(6500)).toBe("6,500원");
    expect(won(0)).toBe("0원");
    expect(won(100000)).toBe("100,000원");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/format.test.ts`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: 구현**

`src/lib/format.ts`:
```typescript
export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/format.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add KRW currency formatter with test"
```

---

## Phase 2 — 인증

### Task 7: 세션 토큰 & 비밀번호 (auth.ts 코어)

**Files:**
- Create: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (순수 함수만 테스트)**

`src/lib/auth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession } from "./auth";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("luvy1234");
    expect(await verifyPassword("luvy1234", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("session token", () => {
  it("round-trips the userId", async () => {
    const token = await signSession({ userId: "user_1" });
    const payload = await verifySession(token);
    expect(payload?.userId).toBe("user_1");
  });
  it("returns null for a tampered token", async () => {
    const token = await signSession({ userId: "user_1" });
    expect(await verifySession(token + "x")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: 구현 (코어 함수 + 쿠키/세션 헬퍼)**

`src/lib/auth.ts`:
```typescript
import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

export const SESSION_COOKIE = "luvy_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-luvy-secret-change-in-prod-0123456789abcdef",
);

export type SessionPayload = { userId: string };
export type SessionUser = { id: string; email: string; companyName: string };

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function createSession(userId: string): Promise<void> {
  const token = await signSession({ userId });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, companyName: true },
  });
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}
```

Note: `bcryptjs`·`jose`는 node에서 동작하므로 순수 함수 테스트가 가능하다. `cookies()`/`redirect()`를 쓰는 함수는 테스트하지 않고 이후 브라우저 플로우로 검증한다.

- [ ] **Step 4: 통과 확인**

Run: `npm test -- src/lib/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: add auth core (bcrypt hash + jose session cookie)"
```

---

### Task 8: 인증 서버 액션

**Files:**
- Create: `src/lib/actions/auth.ts`

- [ ] **Step 1: `src/lib/actions/auth.ts` 작성**

```typescript
"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { isValidBizNumber, isValidEmail, normalizeBizNumber } from "@/lib/validation";

export type AuthState = { error?: string };

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const companyName = String(formData.get("companyName") ?? "").trim();
  const businessNumber = String(formData.get("businessNumber") ?? "");
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!isValidEmail(email)) return { error: "올바른 이메일을 입력해주세요." };
  if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 합니다." };
  if (password !== passwordConfirm) return { error: "비밀번호가 일치하지 않습니다." };
  if (!companyName) return { error: "상호명을 입력해주세요." };
  if (!isValidBizNumber(businessNumber)) return { error: "사업자등록번호 10자리를 확인해주세요." };
  if (!ownerName) return { error: "대표자명을 입력해주세요." };
  if (!phone) return { error: "연락처를 입력해주세요." };

  const exists = await db.user.findUnique({ where: { email } });
  if (exists) return { error: "이미 가입된 이메일입니다." };

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      companyName,
      businessNumber: normalizeBizNumber(businessNumber),
      ownerName,
      phone,
      status: "APPROVED",
    },
  });

  await createSession(user.id);
  redirect("/");
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  await createSession(user.id);
  redirect(next.startsWith("/") ? next : "/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (기존 컴포넌트가 없는 참조는 이후 태스크에서 생성).

- [ ] **Step 3: 커밋**

```bash
git add src/lib/actions/auth.ts
git commit -m "feat: add signup/login/logout server actions"
```

---

### Task 9: 인증 폼 컴포넌트

**Files:**
- Create: `src/components/auth/AuthField.tsx`, `SubmitButton.tsx`, `AuthCard.tsx`

- [ ] **Step 1: `src/components/auth/AuthField.tsx`**

```tsx
interface AuthFieldProps {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
}

export function AuthField({ label, name, type = "text", placeholder, required = true, autoComplete }: AuthFieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-soft">{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-xl border border-line bg-white px-4 text-[15px] text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none"
      />
    </label>
  );
}
```

- [ ] **Step 2: `src/components/auth/SubmitButton.tsx`**

```tsx
"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-12 w-full rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? "처리 중…" : children}
    </button>
  );
}
```

- [ ] **Step 3: `src/components/auth/AuthCard.tsx`**

```tsx
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[440px] flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-[24px] font-extrabold text-ink">{title}</h1>
        <p className="mt-2 text-[14px] text-muted">{subtitle}</p>
      </div>
      <div className="rounded-2xl border border-line bg-white p-7 shadow-[var(--shadow-soft)]">
        {children}
      </div>
      <div className="mt-6 text-center text-[14px] text-muted">{footer}</div>
      <Link href="/" className="mt-4 text-center text-[13px] text-muted hover:text-brand-500">
        ← 메인으로 돌아가기
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/auth
git commit -m "feat: add reusable auth form components"
```

---

### Task 10: 로그인 페이지

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/LoginForm.tsx`

- [ ] **Step 1: `src/app/(auth)/login/LoginForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { loginAction, type AuthState } from "@/lib/actions/auth";
import { AuthField } from "@/components/auth/AuthField";
import { SubmitButton } from "@/components/auth/SubmitButton";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<AuthState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <AuthField label="이메일" name="email" type="email" placeholder="business@company.com" autoComplete="email" />
      <AuthField label="비밀번호" name="password" type="password" autoComplete="current-password" />
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <SubmitButton>로그인</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: `src/app/(auth)/login/page.tsx`**

```tsx
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthCard
      title="파트너 로그인"
      subtitle="LUVY 사업자 회원 전용 서비스입니다."
      footer={
        <>
          아직 회원이 아니신가요?{" "}
          <Link href="/signup" className="font-semibold text-brand-600 hover:underline">
            회원가입
          </Link>
        </>
      }
    >
      <LoginForm next={next ?? "/"} />
      <p className="mt-5 rounded-xl bg-brand-50 px-4 py-3 text-center text-[12px] text-brand-600">
        데모 계정: demo@luvy.co.kr / luvy1234
      </p>
    </AuthCard>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(auth)/login"
git commit -m "feat: add login page"
```

---

### Task 11: 회원가입 페이지

**Files:**
- Create: `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/signup/SignupForm.tsx`

- [ ] **Step 1: `src/app/(auth)/signup/SignupForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { signupAction, type AuthState } from "@/lib/actions/auth";
import { AuthField } from "@/components/auth/AuthField";
import { SubmitButton } from "@/components/auth/SubmitButton";

export function SignupForm() {
  const [state, action] = useActionState<AuthState, FormData>(signupAction, {});
  return (
    <form action={action} className="space-y-4">
      <AuthField label="이메일" name="email" type="email" placeholder="business@company.com" autoComplete="email" />
      <AuthField label="비밀번호 (8자 이상)" name="password" type="password" autoComplete="new-password" />
      <AuthField label="비밀번호 확인" name="passwordConfirm" type="password" autoComplete="new-password" />
      <div className="my-2 border-t border-line" />
      <AuthField label="상호명" name="companyName" placeholder="(주)러비상사" />
      <AuthField label="사업자등록번호" name="businessNumber" placeholder="123-45-67890" />
      <AuthField label="대표자명" name="ownerName" />
      <AuthField label="연락처" name="phone" placeholder="010-0000-0000" autoComplete="tel" />
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <SubmitButton>회원가입</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: `src/app/(auth)/signup/page.tsx`**

```tsx
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <AuthCard
      title="사업자 회원가입"
      subtitle="만 19세 이상 사업자 회원만 가입할 수 있습니다."
      footer={
        <>
          이미 회원이신가요?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            로그인
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add "src/app/(auth)/signup"
git commit -m "feat: add business member signup page"
```

---

### Task 12: 라우트 가드 (middleware)

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: `src/middleware.ts` 작성**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "luvy_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "dev-only-luvy-secret-change-in-prod-0123456789abcdef",
);

const PROTECTED = ["/category", "/search", "/products", "/cart", "/checkout", "/orders"];

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isProtected) return NextResponse.next();

  if (await hasValidSession(req)) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/category/:path*", "/search/:path*", "/products/:path*", "/cart/:path*", "/checkout/:path*", "/orders/:path*"],
};
```

- [ ] **Step 2: 브라우저 검증 — 가드 동작**

- 개발 서버 실행: preview_start (name: `luvy-dev`).
- 시크릿 상태(비로그인)에서 `http://localhost:3000/cart` 접속.
- Expected: `/login?next=/cart` 로 리다이렉트.
- `http://localhost:3000/` 접속 → 정상(랜딩 노출).

- [ ] **Step 3: 커밋**

```bash
git add src/middleware.ts
git commit -m "feat: guard member-only routes via middleware"
```

---

### Task 13: 헤더 로그인 상태 연동

**Files:**
- Create: `src/components/account/AuthMenu.tsx`
- Modify: `src/components/layout/UtilBar.tsx`, `src/components/layout/Header.tsx`

- [ ] **Step 1: `src/components/account/AuthMenu.tsx` 작성**

```tsx
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

export async function AuthMenu() {
  const user = await getSession();

  if (!user) {
    return (
      <>
        <Link href="/login" className="text-brand-700/80 transition-colors hover:text-brand-700">
          로그인
        </Link>
        <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
        <Link href="/signup" className="text-brand-700/80 transition-colors hover:text-brand-700">
          회원가입
        </Link>
      </>
    );
  }

  return (
    <>
      <span className="font-semibold text-brand-700">{user.companyName}님</span>
      <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
      <Link href="/orders" className="text-brand-700/80 transition-colors hover:text-brand-700">
        주문내역
      </Link>
      <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
      <form action={logoutAction}>
        <button type="submit" className="text-brand-700/80 transition-colors hover:text-brand-700">
          로그아웃
        </button>
      </form>
    </>
  );
}
```

- [ ] **Step 2: `UtilBar.tsx` 수정 — 우측 링크를 AuthMenu + 고정 링크로 교체**

`src/components/layout/UtilBar.tsx`의 `<nav>...</nav>` 블록 전체를 아래로 교체(로그인/회원가입/장바구니/주문조회/고객센터 중 로그인·회원가입·주문조회 부분을 AuthMenu가 담당):
```tsx
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AuthMenu } from "@/components/account/AuthMenu";

export function UtilBar() {
  return (
    <div className="w-full bg-brand-100/80 text-brand-700">
      <div className="mx-auto flex h-9 max-w-[1280px] items-center justify-between px-6 text-[12px]">
        <div className="flex items-center gap-2 font-medium">
          <Icon name="truck" className="h-3.5 w-3.5" strokeWidth={2} />
          <span>빠르고 안전한 B2B 배송 시스템</span>
        </div>
        <nav className="flex items-center">
          <AuthMenu />
          <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
          <Link href="/support" className="text-brand-700/80 transition-colors hover:text-brand-700">
            고객센터
          </Link>
        </nav>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 브라우저 검증**

- 데모 계정으로 `/login` 로그인 → 메인 상단에 `러비데모상사님 · 주문내역 · 로그아웃` 노출.
- 로그아웃 클릭 → `로그인 · 회원가입` 으로 복귀.

- [ ] **Step 5: 커밋**

```bash
git add src/components/account src/components/layout/UtilBar.tsx
git commit -m "feat: reflect auth state in header util bar"
```

---

## Phase 3 — 카탈로그

### Task 14: 상품 썸네일 & 카드

**Files:**
- Create: `src/components/product/ProductThumb.tsx`, `ProductCard.tsx`, `ProductGrid.tsx`

- [ ] **Step 1: `src/components/product/ProductThumb.tsx`**

```tsx
/** 실제 상품 사진이 없어 브랜드 이니셜 기반의 결정적 파스텔 타일을 렌더한다. */
const palettes = [
  "from-brand-100 to-brand-200",
  "from-brand-50 to-brand-100",
  "from-brand-200 to-brand-300",
  "from-cream to-brand-100",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function ProductThumb({ id, brand, className = "" }: { id: string; brand: string; className?: string }) {
  const palette = palettes[hash(id) % palettes.length];
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${palette} ${className}`}>
      <span className="text-[28px] font-extrabold tracking-tight text-white/80">{brand}</span>
    </div>
  );
}
```

- [ ] **Step 2: `src/components/product/ProductCard.tsx`**

```tsx
import Link from "next/link";
import { ProductThumb } from "./ProductThumb";
import { won } from "@/lib/format";
import { getMoq, resolveUnitPrice, type Tier } from "@/lib/pricing";

export interface ProductCardData {
  id: string;
  name: string;
  brand: string;
  priceTiers: Tier[];
}

export function ProductCard({ product }: { product: ProductCardData }) {
  const moq = getMoq(product.priceTiers);
  const fromPrice = resolveUnitPrice(product.priceTiers, moq);
  return (
    <Link
      href={`/products/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <ProductThumb id={product.id} brand={product.brand} className="aspect-square w-full" />
      <div className="flex flex-1 flex-col p-4">
        <span className="text-[12px] font-semibold text-brand-500">{product.brand}</span>
        <h3 className="mt-1 line-clamp-2 flex-1 text-[14px] font-medium text-ink group-hover:text-brand-600">
          {product.name}
        </h3>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <span className="text-[11px] text-muted">도매가</span>
            <p className="text-[16px] font-extrabold text-ink">{won(fromPrice)}~</p>
          </div>
          <span className="rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">
            MOQ {moq}
          </span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: `src/components/product/ProductGrid.tsx`**

```tsx
import { ProductCard, type ProductCardData } from "./ProductCard";

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  if (products.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-line text-[14px] text-muted">
        표시할 상품이 없습니다.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/components/product/ProductThumb.tsx src/components/product/ProductCard.tsx src/components/product/ProductGrid.tsx
git commit -m "feat: add product card/grid/thumb components"
```

---

### Task 15: 카테고리 목록 페이지 + 정렬

**Files:**
- Create: `src/app/category/[slug]/page.tsx`, `src/components/product/SortSelect.tsx`

- [ ] **Step 1: `src/components/product/SortSelect.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

const options = [
  { value: "new", label: "신상품순" },
  { value: "priceAsc", label: "가격 낮은순" },
  { value: "priceDesc", label: "가격 높은순" },
];

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("sort") ?? "new";

  return (
    <select
      value={current}
      onChange={(e) => {
        const sp = new URLSearchParams(params);
        sp.set("sort", e.target.value);
        router.push(`${pathname}?${sp.toString()}`);
      }}
      className="h-10 rounded-lg border border-line bg-white px-3 text-[13px] text-ink focus:border-brand-400 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: `src/app/category/[slug]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { categories } from "@/lib/mock/categories";
import { ProductGrid } from "@/components/product/ProductGrid";
import { SortSelect } from "@/components/product/SortSelect";

const orderByFor = (sort?: string) => {
  if (sort === "priceAsc") return { basePrice: "asc" as const };
  if (sort === "priceDesc") return { basePrice: "desc" as const };
  return { createdAt: "desc" as const };
};

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { slug } = await params;
  const { sort } = await searchParams;
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const products = await db.product.findMany({
    where: { categorySlug: slug, status: "ACTIVE" },
    orderBy: orderByFor(sort),
    include: { priceTiers: true },
  });

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-[13px] font-semibold text-brand-500">CATEGORY</p>
          <h1 className="mt-1 text-[28px] font-extrabold text-ink">{category.name}</h1>
          <p className="mt-1 text-[13px] text-muted">{products.length}개 상품</p>
        </div>
        <SortSelect />
      </div>
      <ProductGrid products={products} />
    </div>
  );
}
```

- [ ] **Step 3: 브라우저 검증**

- (로그인 상태) `/category/condom-lube` 접속 → 해당 카테고리 상품 카드 노출, 상단에 상품 수/정렬.
- 정렬 `가격 낮은순` 선택 → URL `?sort=priceAsc`, 순서 변경.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/category" src/components/product/SortSelect.tsx
git commit -m "feat: add category listing page with sort"
```

---

### Task 16: 검색 페이지

**Files:**
- Create: `src/app/search/page.tsx`
- Modify: `src/components/layout/SearchBar.tsx`

- [ ] **Step 1: `src/app/search/page.tsx`**

```tsx
import { db } from "@/lib/db";
import { ProductGrid } from "@/components/product/ProductGrid";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const products = query
    ? await db.product.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ name: { contains: query } }, { brand: { contains: query } }],
        },
        include: { priceTiers: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10">
      <h1 className="mb-1 text-[24px] font-extrabold text-ink">
        {query ? `‘${query}’ 검색 결과` : "검색어를 입력해주세요"}
      </h1>
      <p className="mb-6 text-[13px] text-muted">{products.length}개 상품</p>
      <ProductGrid products={products} />
    </div>
  );
}
```

- [ ] **Step 2: `SearchBar.tsx` 수정 — 제출 시 `/search`로 이동**

`src/components/layout/SearchBar.tsx` 전체 교체:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function SearchBar() {
  const router = useRouter();
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q")?.toString().trim() ?? "";
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
      className="group flex h-12 w-full max-w-[380px] items-center gap-2 rounded-pill border border-brand-200 bg-white pl-5 pr-2 transition-colors focus-within:border-brand-400"
    >
      <input
        name="q"
        type="text"
        placeholder="상품명 또는 키워드를 검색하세요"
        aria-label="상품 검색"
        className="h-full flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
      />
      <button
        type="submit"
        aria-label="검색"
        className="flex h-9 w-9 items-center justify-center rounded-full text-brand-500 transition-colors hover:bg-brand-50"
      >
        <Icon name="search" className="h-5 w-5" strokeWidth={2} />
      </button>
    </form>
  );
}
```

- [ ] **Step 3: 브라우저 검증**

- 헤더 검색창에 `콘돔` 입력 후 엔터 → `/search?q=콘돔`, 매칭 상품 노출.

- [ ] **Step 4: 커밋**

```bash
git add src/app/search src/components/layout/SearchBar.tsx
git commit -m "feat: add product search page and wire search bar"
```

---

### Task 17: 상품 상세 페이지

**Files:**
- Create: `src/app/products/[id]/page.tsx`, `src/components/product/PriceTierTable.tsx`, `src/components/product/QtyStepper.tsx`, `src/components/product/AddToCart.tsx`

- [ ] **Step 1: `src/components/product/PriceTierTable.tsx`**

```tsx
import { won } from "@/lib/format";
import type { Tier } from "@/lib/pricing";

export function PriceTierTable({ tiers }: { tiers: Tier[] }) {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  return (
    <table className="w-full overflow-hidden rounded-xl border border-line text-[14px]">
      <thead>
        <tr className="bg-brand-50 text-brand-700">
          <th className="px-4 py-2.5 text-left font-bold">주문 수량</th>
          <th className="px-4 py-2.5 text-right font-bold">개당 도매가</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((t, i) => {
          const next = sorted[i + 1];
          const range = next ? `${t.minQty} ~ ${next.minQty - 1}개` : `${t.minQty}개 이상`;
          return (
            <tr key={t.minQty} className="border-t border-line">
              <td className="px-4 py-2.5 text-ink-soft">{range}</td>
              <td className="px-4 py-2.5 text-right font-bold text-ink">{won(t.unitPrice)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: `src/components/product/QtyStepper.tsx`**

```tsx
"use client";

interface QtyStepperProps {
  value: number;
  min: number;
  onChange: (v: number) => void;
}

export function QtyStepper({ value, min, onChange }: QtyStepperProps) {
  return (
    <div className="inline-flex h-11 items-center rounded-pill border border-line bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-full w-11 items-center justify-center text-[18px] text-ink-soft hover:text-brand-500"
        aria-label="수량 감소"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="h-full w-14 [appearance:textfield] bg-transparent text-center text-[15px] font-semibold text-ink focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
        aria-label="수량"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-full w-11 items-center justify-center text-[18px] text-ink-soft hover:text-brand-500"
        aria-label="수량 증가"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 3: `src/components/product/AddToCart.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QtyStepper } from "./QtyStepper";
import { addToCart } from "@/lib/actions/cart";
import { won } from "@/lib/format";
import { resolveUnitPrice, type Tier } from "@/lib/pricing";

export function AddToCart({ productId, tiers, moq }: { productId: string; tiers: Tier[]; moq: number }) {
  const [qty, setQty] = useState(moq);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  const unit = resolveUnitPrice(tiers, qty);
  const total = unit * qty;

  const submit = (goCheckout: boolean) =>
    startTransition(async () => {
      await addToCart(productId, qty);
      if (goCheckout) router.push("/checkout");
      else {
        setDone(true);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
        <span className="text-[13px] text-ink-soft">주문 수량 (최소 {moq}개)</span>
        <QtyStepper value={qty} min={moq} onChange={(v) => { setQty(v); setDone(false); }} />
      </div>
      <div className="flex items-center justify-between border-t border-line pt-4">
        <span className="text-[14px] text-ink-soft">적용 단가 {won(unit)} · 합계</span>
        <span className="text-[22px] font-extrabold text-brand-600">{won(total)}</span>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(false)}
          className="h-12 flex-1 rounded-pill border border-brand-300 bg-white text-[15px] font-bold text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-60"
        >
          {done ? "담김 ✓" : "장바구니 담기"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(true)}
          className="h-12 flex-1 rounded-pill bg-brand-500 text-[15px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          바로 주문
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/app/products/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { categories } from "@/lib/mock/categories";
import { ProductThumb } from "@/components/product/ProductThumb";
import { PriceTierTable } from "@/components/product/PriceTierTable";
import { AddToCart } from "@/components/product/AddToCart";
import { getMoq } from "@/lib/pricing";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id }, include: { priceTiers: true } });
  if (!product || product.status !== "ACTIVE") notFound();

  const category = categories.find((c) => c.slug === product.categorySlug);
  const moq = getMoq(product.priceTiers);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <div className="grid gap-10 lg:grid-cols-2">
        <ProductThumb id={product.id} brand={product.brand} className="aspect-square w-full rounded-2xl" />
        <div>
          <p className="text-[13px] font-semibold text-brand-500">
            {product.brand}{category ? ` · ${category.name}` : ""}
          </p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-snug text-ink">{product.name}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{product.description}</p>

          <div className="mt-8">
            <h2 className="mb-3 text-[15px] font-bold text-ink">수량별 도매가</h2>
            <PriceTierTable tiers={product.priceTiers} />
          </div>

          <div className="mt-8">
            <AddToCart productId={product.id} tiers={product.priceTiers} moq={moq} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 타입 체크 (addToCart은 다음 태스크에서 생성 — 임시로 통과 불가)**

이 태스크는 `addToCart`에 의존하므로 Task 18과 함께 검증한다. 여기서는 파일만 커밋.

- [ ] **Step 6: 커밋**

```bash
git add "src/app/products" src/components/product/PriceTierTable.tsx src/components/product/QtyStepper.tsx src/components/product/AddToCart.tsx
git commit -m "feat: add product detail page with tier table and add-to-cart UI"
```

---

## Phase 4 — 장바구니

### Task 18: 장바구니 서버 액션

**Files:**
- Create: `src/lib/actions/cart.ts`

- [ ] **Step 1: `src/lib/actions/cart.ts` 작성**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getMoq, type Tier } from "@/lib/pricing";

export async function addToCart(productId: string, quantity: number): Promise<void> {
  const user = await requireUser();
  const product = await db.product.findUnique({ where: { id: productId }, include: { priceTiers: true } });
  if (!product) return;

  const moq = getMoq(product.priceTiers as Tier[]);
  const qty = Math.max(moq, Math.floor(quantity) || moq);

  await db.cartItem.upsert({
    where: { userId_productId: { userId: user.id, productId } },
    create: { userId: user.id, productId, quantity: qty },
    update: { quantity: { increment: qty } },
  });

  revalidatePath("/cart");
  revalidatePath("/", "layout"); // 헤더 뱃지
}

export async function updateCartQty(itemId: string, quantity: number): Promise<void> {
  const user = await requireUser();
  const item = await db.cartItem.findUnique({ where: { id: itemId }, include: { product: { include: { priceTiers: true } } } });
  if (!item || item.userId !== user.id) return;

  const moq = getMoq(item.product.priceTiers as Tier[]);
  const qty = Math.max(moq, Math.floor(quantity) || moq);

  await db.cartItem.update({ where: { id: itemId }, data: { quantity: qty } });
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

export async function removeCartItem(itemId: string): Promise<void> {
  const user = await requireUser();
  const item = await db.cartItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return;

  await db.cartItem.delete({ where: { id: itemId } });
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

export async function getCartCount(): Promise<number> {
  const { getSession } = await import("@/lib/auth");
  const user = await getSession();
  if (!user) return 0;
  const items = await db.cartItem.findMany({ where: { userId: user.id }, select: { quantity: true } });
  return items.reduce((sum, i) => sum + i.quantity, 0);
}
```

- [ ] **Step 2: 타입 체크 (이제 상품상세 + 장바구니 액션 연결됨)**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/actions/cart.ts
git commit -m "feat: add server-side cart actions"
```

---

### Task 19: 헤더 장바구니 뱃지 서버 연동

**Files:**
- Modify: `src/components/layout/Header.tsx`

- [ ] **Step 1: `Header.tsx` 수정 — 서버에서 카트 수량 조회**

`src/components/layout/Header.tsx`에서 `const cartCount = 0;`을 제거하고 컴포넌트를 async로 변경 + 뱃지 조건부 렌더:
```tsx
import Link from "next/link";
import { Logo } from "./Logo";
import { Gnb } from "./Gnb";
import { SearchBar } from "./SearchBar";
import { Icon } from "@/components/ui/Icon";
import { getCartCount } from "@/lib/actions/cart";

export async function Header() {
  const cartCount = await getCartCount();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[76px] max-w-[1280px] items-center gap-8 px-6">
        <Logo />
        <div className="flex-1">
          <Gnb />
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:block">
            <SearchBar />
          </div>
          <Link
            href="/cart"
            aria-label="장바구니"
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-brand-50 hover:text-brand-500"
          >
            <Icon name="cart" className="h-6 w-6" strokeWidth={1.6} />
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-[11px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 브라우저 검증**

- 상품 상세에서 "장바구니 담기" → 헤더 카트 뱃지 수량 증가 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/components/layout/Header.tsx
git commit -m "feat: wire header cart badge to server cart count"
```

---

### Task 20: 장바구니 페이지

**Files:**
- Create: `src/app/cart/page.tsx`, `src/components/cart/CartItemRow.tsx`, `src/components/cart/CartSummary.tsx`

- [ ] **Step 1: `src/components/cart/CartItemRow.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductThumb } from "@/components/product/ProductThumb";
import { QtyStepper } from "@/components/product/QtyStepper";
import { updateCartQty, removeCartItem } from "@/lib/actions/cart";
import { won } from "@/lib/format";
import { resolveUnitPrice, type Tier } from "@/lib/pricing";

export interface CartRowData {
  id: string;
  productId: string;
  name: string;
  brand: string;
  quantity: number;
  moq: number;
  tiers: Tier[];
}

export function CartItemRow({ item }: { item: CartRowData }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const unit = resolveUnitPrice(item.tiers, item.quantity);

  const changeQty = (v: number) =>
    startTransition(async () => {
      await updateCartQty(item.id, v);
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      await removeCartItem(item.id);
      router.refresh();
    });

  return (
    <div className={`flex items-center gap-4 border-b border-line py-4 ${pending ? "opacity-60" : ""}`}>
      <ProductThumb id={item.productId} brand={item.brand} className="h-20 w-20 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-brand-500">{item.brand}</p>
        <p className="truncate text-[14px] font-medium text-ink">{item.name}</p>
        <p className="mt-1 text-[12px] text-muted">적용 단가 {won(unit)}</p>
      </div>
      <QtyStepper value={item.quantity} min={item.moq} onChange={changeQty} />
      <div className="w-28 text-right text-[15px] font-bold text-ink">{won(unit * item.quantity)}</div>
      <button type="button" onClick={remove} className="text-[13px] text-muted hover:text-brand-600">
        삭제
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `src/components/cart/CartSummary.tsx`**

```tsx
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
```

- [ ] **Step 3: `src/app/cart/page.tsx`**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CartItemRow, type CartRowData } from "@/components/cart/CartItemRow";
import { CartSummary } from "@/components/cart/CartSummary";
import { getMoq, resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";

export default async function CartPage() {
  const user = await requireUser();
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true } } },
    orderBy: { id: "desc" },
  });

  const rows: CartRowData[] = items.map((it) => ({
    id: it.id,
    productId: it.productId,
    name: it.product.name,
    brand: it.product.brand,
    quantity: it.quantity,
    moq: getMoq(it.product.priceTiers as Tier[]),
    tiers: it.product.priceTiers as Tier[],
  }));

  const subtotal = rows.reduce((sum, r) => sum + resolveUnitPrice(r.tiers, r.quantity) * r.quantity, 0);
  const shippingFee = shippingFor(subtotal);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">장바구니</h1>
      {rows.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line">
          <p className="text-[15px] text-muted">장바구니가 비어 있습니다.</p>
          <Link href="/category/women" className="rounded-pill bg-brand-500 px-6 py-2.5 text-[14px] font-bold text-white hover:bg-brand-600">
            쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            {rows.map((r) => (
              <CartItemRow key={r.id} item={r} />
            ))}
          </div>
          <CartSummary subtotal={subtotal} shippingFee={shippingFee} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 브라우저 검증**

- 상품 담은 뒤 `/cart` → 품목/수량/단가/합계 노출. 수량 변경 시 티어 단가·합계 갱신. 삭제 동작.

- [ ] **Step 5: 커밋**

```bash
git add src/app/cart src/components/cart
git commit -m "feat: add cart page with quantity/remove and summary"
```

---

## Phase 5 — 주문

### Task 21: 주문 생성 서버 액션

**Files:**
- Create: `src/lib/actions/order.ts`

- [ ] **Step 1: `src/lib/actions/order.ts` 작성**

```typescript
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";

export type OrderState = { error?: string };

export async function placeOrder(_prev: OrderState, formData: FormData): Promise<OrderState> {
  const user = await requireUser();

  const recipient = String(formData.get("recipient") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!recipient || !phone || !address) {
    return { error: "수령인, 연락처, 주소를 모두 입력해주세요." };
  }

  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true } } },
  });
  if (items.length === 0) return { error: "장바구니가 비어 있습니다." };

  const orderItems = items.map((it) => {
    const unitPrice = resolveUnitPrice(it.product.priceTiers as Tier[], it.quantity);
    return {
      productId: it.productId,
      name: it.product.name,
      brand: it.product.brand,
      unitPrice,
      quantity: it.quantity,
      lineTotal: unitPrice * it.quantity,
    };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const shippingFee = shippingFor(subtotal);

  const order = await db.order.create({
    data: {
      userId: user.id,
      recipient,
      phone,
      address,
      memo,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      items: { create: orderItems },
    },
  });

  await db.cartItem.deleteMany({ where: { userId: user.id } });
  revalidatePath("/", "layout");
  redirect(`/checkout/complete?order=${order.id}`);
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/lib/actions/order.ts
git commit -m "feat: add place-order action (simulated, no payment)"
```

---

### Task 22: 주문/결제 페이지

**Files:**
- Create: `src/app/checkout/page.tsx`, `src/app/checkout/CheckoutForm.tsx`

- [ ] **Step 1: `src/app/checkout/CheckoutForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { placeOrder, type OrderState } from "@/lib/actions/order";
import { AuthField } from "@/components/auth/AuthField";
import { SubmitButton } from "@/components/auth/SubmitButton";

export function CheckoutForm() {
  const [state, action] = useActionState<OrderState, FormData>(placeOrder, {});
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
      <h2 className="text-[16px] font-bold text-ink">배송 정보</h2>
      <AuthField label="수령인" name="recipient" />
      <AuthField label="연락처" name="phone" placeholder="010-0000-0000" autoComplete="tel" />
      <AuthField label="주소" name="address" placeholder="도로명 주소 + 상세주소" />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-soft">배송 메모 (선택)</span>
        <textarea
          name="memo"
          rows={2}
          className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none"
          placeholder="예) 부재 시 문 앞에 놓아주세요"
        />
      </label>
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <p className="rounded-xl bg-brand-50 px-4 py-3 text-[12px] text-brand-600">
        실제 결제(PG) 연동은 데모 범위에서 제외되며, ‘주문 접수’로 처리됩니다.
      </p>
      <SubmitButton>주문 접수하기</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: `src/app/checkout/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CheckoutForm } from "./CheckoutForm";
import { won } from "@/lib/format";
import { resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";

export default async function CheckoutPage() {
  const user = await requireUser();
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true } } },
  });
  if (items.length === 0) redirect("/cart");

  const lines = items.map((it) => {
    const unit = resolveUnitPrice(it.product.priceTiers as Tier[], it.quantity);
    return { id: it.id, name: it.product.name, quantity: it.quantity, lineTotal: unit * it.quantity };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shippingFee = shippingFor(subtotal);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">주문/결제</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <CheckoutForm />
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
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/checkout/page.tsx src/app/checkout/CheckoutForm.tsx
git commit -m "feat: add checkout page with order summary"
```

---

### Task 23: 주문 완료 페이지

**Files:**
- Create: `src/app/checkout/complete/page.tsx`

- [ ] **Step 1: `src/app/checkout/complete/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";

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
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/checkout/complete
git commit -m "feat: add order completion page"
```

---

### Task 24: 주문 내역 & 상세

**Files:**
- Create: `src/app/orders/page.tsx`, `src/app/orders/[id]/page.tsx`

- [ ] **Step 1: `src/app/orders/page.tsx`**

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await db.order.findMany({
    where: { userId: user.id },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-[880px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">주문 내역</h1>
      {orders.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-line text-[14px] text-muted">
          주문 내역이 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => {
            const first = o.items[0];
            const rest = o.items.length - 1;
            return (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="block rounded-2xl border border-line bg-white p-5 transition-shadow hover:shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center justify-between text-[12px] text-muted">
                  <span>{dateFmt(o.createdAt)} · 주문 {o.id.slice(0, 8).toUpperCase()}</span>
                  <span className="rounded-pill bg-brand-50 px-2.5 py-1 font-bold text-brand-600">접수됨</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[15px] font-medium text-ink">
                    {first?.name}{rest > 0 ? ` 외 ${rest}건` : ""}
                  </p>
                  <p className="text-[16px] font-extrabold text-ink">{won(o.total)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `src/app/orders/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.userId !== user.id) notFound();

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <h1 className="text-[24px] font-extrabold text-ink">주문 상세</h1>
      <p className="mt-1 text-[13px] text-muted">주문번호 {order.id.slice(0, 8).toUpperCase()}</p>

      <section className="mt-8 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="mb-4 text-[15px] font-bold text-ink">주문 상품</h2>
        <ul className="space-y-3 text-[14px]">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="text-[12px] font-semibold text-brand-500">{i.brand}</span>
                <span className="block truncate text-ink-soft">{i.name} × {i.quantity} ({won(i.unitPrice)})</span>
              </span>
              <span className="shrink-0 font-semibold text-ink">{won(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="mb-4 text-[15px] font-bold text-ink">배송지</h2>
        <dl className="space-y-1.5 text-[14px] text-ink-soft">
          <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">수령인</dt><dd>{order.recipient}</dd></div>
          <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">연락처</dt><dd>{order.phone}</dd></div>
          <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">주소</dt><dd>{order.address}</dd></div>
          {order.memo && <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">메모</dt><dd>{order.memo}</dd></div>}
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <dl className="space-y-2 text-[14px]">
          <div className="flex justify-between text-ink-soft"><dt>상품 합계</dt><dd>{won(order.subtotal)}</dd></div>
          <div className="flex justify-between text-ink-soft"><dt>배송비</dt><dd>{order.shippingFee === 0 ? "무료" : won(order.shippingFee)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="font-bold text-ink">합계</dt>
            <dd className="text-[18px] font-extrabold text-brand-600">{won(order.total)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/orders
git commit -m "feat: add order history and detail pages"
```

---

## Phase 6 — 통합 검증

### Task 25: 전체 플로우 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 타입 체크 + 프로덕션 빌드**

먼저 dev 서버가 떠 있으면 중지(‑ `.next` 캐시 충돌 방지).
Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: 타입 에러 0, 빌드 성공.

- [ ] **Step 2: 시드 재적용 후 dev 실행**

Run: `npm run db:seed`
그다음 preview_start (name: `luvy-dev`).

- [ ] **Step 3: 회원전용 가드 확인**

- 비로그인으로 `/orders` → `/login?next=/orders` 리다이렉트.

- [ ] **Step 4: 데모 계정 전체 플로우**

1. `/login`에서 demo@luvy.co.kr / luvy1234 로그인 → 메인, 헤더에 상호명 노출.
2. `/category/women` → 상품 카드 노출.
3. 상품 클릭 → 상세에서 수량별 도매가 표 확인, 수량 30으로 변경 시 단가 하락 반영.
4. "장바구니 담기" → 헤더 뱃지 증가.
5. `/cart` → 수량 변경/삭제 동작, 합계·배송비 갱신.
6. "주문하기" → `/checkout` 배송정보 입력 → "주문 접수하기".
7. `/checkout/complete` 주문번호·요약 노출, 장바구니 비워짐(헤더 뱃지 0).
8. `/orders` 목록 → 상세 진입 확인.

- [ ] **Step 5: 콘솔/네트워크 에러 점검**

- read_console_messages(onlyErrors) → 신규 에러 없음.

- [ ] **Step 6: 최종 커밋**

```bash
git add -A
git commit -m "chore: verify member commerce v1 end-to-end"
```

---

## Self-Review 결과 (spec 대비)

- 접근 제어(회원전용, middleware): Task 12, 검증 Task 25 ✓
- 인증(가입/로그인/로그아웃, 헤더 상태): Task 7–11, 13 ✓
- 데이터 모델(User/Product/PriceTier/CartItem/Order/OrderItem): Task 1 ✓
- 가격 로직(티어/MOQ/배송비): Task 4 ✓
- 카탈로그(목록/정렬/검색/상세/티어표): Task 14–17 ✓
- 장바구니(담기/수량/삭제/뱃지): Task 18–20 ✓
- 주문(접수/완료/내역/상세, 모의결제): Task 21–24 ✓
- 시드 + 데모 계정 + 플레이스홀더 이미지: Task 2, 14 ✓
- 성공 기준 1–5: Task 25 ✓

타입 일관성: `Tier`(pricing.ts) 전 컴포넌트 공유, `resolveUnitPrice`/`getMoq`/`shippingFor` 시그니처 일관, `AuthState`/`OrderState` 액션 상태 일관, `addToCart(productId, quantity)` 호출부(AddToCart)와 정의부 일치.
