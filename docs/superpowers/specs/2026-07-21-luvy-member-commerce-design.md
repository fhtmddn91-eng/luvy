# LUVY 회원전용 B2B 커머스 — 필수 기능 v1 설계

- 작성일: 2026-07-21
- 범위: 미구현 부분 중 "필수 기능" (실제 회원이 한 번 주문을 완료하는 최소 루프)
- 선행: [메인 페이지 구조 설계](2026-07-21-luvy-shop-structure-design.md)
- 확정 방향: **완전 회원전용 + 실제 백엔드 + 도매 필수 요소**

## 1. 목표

로그인한 B2B 사업자 회원이 **카탈로그 탐색 → 상품 담기 → 주문 접수 → 주문 조회**까지
실제로 완료할 수 있는 최소 기능을 실제 DB 위에서 구현한다. 결제(PG)는 정책상
제외하고 "주문 접수"로 시뮬레이션한다.

## 2. 기술 스택 추가

| 영역 | 선택 | 비고 |
|---|---|---|
| DB | SQLite (dev) + Prisma ORM | 파일 DB, 무설정. 추후 Postgres 이전 용이 |
| 인증 | 경량 세션: `bcryptjs` 해시 + `jose` 서명 JWT를 httpOnly 쿠키에 저장 | 라이브러리 특이사항 없이 이해 가능. DB 세션 테이블 불필요 |
| 변경 작업 | Next.js Server Actions | 폼 제출 + `revalidatePath` 캐시 갱신 |
| 라우트 가드 | `middleware.ts` | 회원전용 경로 보호 |
| 결제 | 없음 (모의 주문 접수) | 실제 카드/PG 입력 금지 → 주문 레코드 생성으로 대체 |

추가 의존성: `prisma`, `@prisma/client`, `bcryptjs`, `@types/bcryptjs`, `jose`.

## 3. 접근 제어

- **공개 경로**: `/` (랜딩), `/login`, `/signup`
- **회원전용 경로**(미로그인 → `/login?next=<원래경로>` 리다이렉트):
  `/category/[slug]`, `/search`, `/products/[id]`, `/cart`, `/checkout`,
  `/checkout/complete`, `/orders`, `/orders/[id]`
- `middleware.ts`가 쿠키 세션 유무로 판정. 서버 액션 내부에서도 `requireUser()`로 재확인.
- 헤더/유틸바는 세션을 읽어 로그인 상태 반영:
  - 미로그인: 로그인 · 회원가입
  - 로그인: `{상호명}` · 로그아웃 (마이/주문내역 링크)

## 4. 데이터 모델 (Prisma)

```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  passwordHash   String
  companyName    String        // 상호명
  businessNumber String        // 사업자등록번호 (하이픈 제거 10자리 저장)
  ownerName      String        // 대표자명
  phone          String
  status         String   @default("APPROVED") // PENDING/APPROVED (데모: 자동 승인)
  createdAt      DateTime @default(now())
  cartItems      CartItem[]
  orders         Order[]
}

model Product {
  id           String      @id @default(cuid())
  name         String
  brand        String
  categorySlug String      // categories.ts 의 slug 참조 (카테고리는 정적 유지)
  description  String
  image        String      // 플레이스홀더 URL/키
  basePrice    Int         // 정가(참고용). 실제 결제는 티어 단가 적용
  status       String      @default("ACTIVE")
  createdAt    DateTime    @default(now())
  priceTiers   PriceTier[]
  cartItems    CartItem[]
}

model PriceTier {       // 수량별 도매가. 최소 티어의 minQty = MOQ
  id        String  @id @default(cuid())
  productId String
  minQty    Int
  unitPrice Int
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  @@index([productId])
}

model CartItem {        // 서버 장바구니 (userId 기준)
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
  status      String      @default("RECEIVED") // 접수됨
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

model OrderItem {        // 주문 시점 스냅샷 (가격/이름 보존)
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

카테고리는 고정 내비이므로 `lib/mock/categories.ts`를 그대로 사용(테이블화하지 않음).

## 5. 가격 로직

- `resolveUnitPrice(tiers, qty)`: `minQty <= qty` 인 티어 중 **가장 큰 minQty**의 unitPrice 반환.
- `getMoq(tiers)`: 최소 `minQty`.
- 수량은 항상 `qty >= MOQ`. 라인합 = `unitPrice * qty`.
- 배송비: 기본 3,000원, **합계 100,000원 이상 무료** (상수, 추후 정책화).

## 6. 기능별 설계

### 6.1 인증
- **회원가입 `/signup`**: 이메일, 비밀번호(+확인), 상호명, 사업자등록번호,
  대표자명, 연락처. 사업자번호는 숫자 10자리 형식 검증(+체크섬은 선택).
  중복 이메일 검사. bcrypt 해시 저장. `status=APPROVED`(데모). 성공 시 자동 로그인 + `/`.
- **로그인 `/login`**: 이메일 + 비밀번호. 성공 시 세션 쿠키 발급 + `next` 경로로 이동.
- **로그아웃**: 쿠키 삭제.
- `lib/auth.ts`: `hashPassword`, `verifyPassword`, `createSession`(JWT 서명·쿠키 set),
  `getSession`(쿠키 검증), `requireUser`(없으면 redirect).

### 6.2 카탈로그
- **카테고리 목록 `/category/[slug]`**: 서버에서 Prisma로 해당 slug 상품 조회.
  `ProductGrid`(카드 그리드), 정렬(신상품순/가격낮은순/가격높은순), "더보기"(간단 페이지네이션).
- **검색 `/search?q=`**: 이름/브랜드 부분일치 조회. 동일 그리드. 결과 없음 상태 처리.
- **상품 상세 `/products/[id]`**: 이미지, 브랜드/이름, 설명, **수량별 도매가 표(PriceTierTable)**,
  MOQ 안내, `QtyStepper`(min=MOQ), 현재 수량 기준 적용 단가/합계 표시,
  "장바구니 담기"(서버액션), "바로구매"(담고 `/checkout`).
- **ProductCard**: 이미지, 브랜드, 이름, 대표가(최저 티어가~), MOQ 뱃지.

### 6.3 장바구니
- **`/cart`**: 서버에서 사용자 CartItem + product + tiers 조회. 행별 이미지/이름/수량
  스테퍼(MOQ 존중)/적용단가/라인합/삭제. `CartSummary`: 소계·배송비·합계·"주문하기".
- 담기/수량변경/삭제 = 서버액션 + `revalidatePath('/cart')`.
- 헤더 장바구니 뱃지 = 서버에서 사용자 담긴 품목 수량 합 (로그인 시).

### 6.4 주문 / 결제(모의)
- **`/checkout`**: 장바구니 비어있으면 `/cart`로. 폼(수령인·연락처·주소·배송메모) +
  주문요약(티어 단가 적용, 배송비, 합계). "주문 접수하기" → 서버액션:
  Order + OrderItems(스냅샷) 생성, 장바구니 비움, `/checkout/complete?order=<id>`.
  - 실제 결제 없음. 카드/PG 정보 입력 화면 없음.
- **`/checkout/complete`**: 주문번호, 요약, "주문내역 보기" / "쇼핑 계속하기".

### 6.5 주문 내역
- **`/orders`**: 사용자 주문 목록(일자, 주문번호, 대표상품+외 N건, 합계, 상태).
- **`/orders/[id]`**: 주문 상세(품목 스냅샷, 배송지, 금액 내역).

## 7. 데이터 흐름

- 조회: 서버 컴포넌트에서 `lib/db.ts`(Prisma 싱글턴)로 직접 조회.
- 변경: `lib/actions/*` 서버 액션(회원가입/로그인/로그아웃, 담기/수량/삭제, 주문 생성).
  각 액션은 `requireUser`로 세션 확인 후 처리하고 관련 경로 `revalidatePath`.
- 세션: httpOnly·secure·sameSite=lax 쿠키의 서명 JWT. 서버에서만 검증.

## 8. 폴더 구조 추가

```
prisma/
  schema.prisma
  seed.ts                      # 카테고리별 상품+티어, 데모 회원 시드
src/
  middleware.ts
  lib/
    db.ts                      # Prisma client 싱글턴
    auth.ts                    # 세션/비번 해시/가드
    pricing.ts                 # 티어 단가 계산
    actions/
      auth.ts                  # signup, login, logout
      cart.ts                  # addToCart, updateQty, removeItem
      order.ts                 # placeOrder
  components/
    product/  ProductCard, ProductGrid, PriceTierTable, QtyStepper, SortSelect
    cart/     CartItemRow, CartSummary
    auth/     AuthField, AuthCard
    account/  AuthMenu (헤더 로그인상태)
  app/
    (auth)/login/page.tsx
    (auth)/signup/page.tsx
    category/[slug]/page.tsx
    search/page.tsx
    products/[id]/page.tsx
    cart/page.tsx
    checkout/page.tsx
    checkout/complete/page.tsx
    orders/page.tsx
    orders/[id]/page.tsx
```

## 9. 비범위 (v1 제외)

실제 PG 결제·카드정보 입력, 주소검색 API(Daum 등), 포인트/쿠폰(10,000P 광고는 후순위),
리뷰/Q&A, 위시리스트, 관리자 승인 UI(자동 승인으로 대체), 기획전·브랜드관 페이지,
상품 이미지 업로드(시드 플레이스홀더 사용), 재고 관리.

## 10. 성공 기준

1. 데모 계정으로 로그인 → 카테고리에서 상품 탐색 → 상세에서 수량별 도매가 확인 →
   장바구니 담기 → 주문 접수 → 주문내역에서 확인까지 끊김 없이 동작한다.
2. 미로그인 상태로 회원전용 경로 접근 시 `/login`으로 리다이렉트된다.
3. 수량 변경 시 티어 단가가 올바르게 적용되고, MOQ 미만 수량은 막힌다.
4. 주문 후 장바구니가 비워지고 주문 스냅샷 금액이 보존된다.
5. `npm run build`가 통과하고 콘솔 에러가 없다.

## 11. 리스크 / 메모

- 실제 상품 사진 없음 → 시드 상품은 플레이스홀더 이미지(브랜드 이니셜 타일)로.
- SQLite는 dev 전용. 배포 시 Postgres + 커넥션 풀 필요(추후).
- 세션 서명 키는 `.env`의 `AUTH_SECRET` 사용(시드/개발용 기본값 제공, 배포 시 교체).
- `npm run build`는 dev 서버와 동시에 돌리지 않는다(`.next` 캐시 충돌).
