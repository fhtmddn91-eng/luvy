# LUVY 어드민(CMS) + NHN KCP 결제 연동 설계

- 작성일: 2026-07-21
- 범위: 관리자 시스템(상품/주문/회원/배너·공지) + KCP 결제(카드/계좌이체/간편결제)
- 선행 필수: [회원전용 커머스 v1](2026-07-21-luvy-member-commerce-design.md) — 주문/회원/상품 DB가 있어야 관리 대상이 존재
- 확정 방향: 같은 Next.js 앱의 `/admin` 라우트 그룹, KCP 표준결제창+서버승인

## 1. 아키텍처 결정

- **어드민 위치**: 별도 앱이 아닌 **동일 Next.js 앱의 `/admin` 라우트 그룹**.
  DB/컴포넌트/인증 재사용, 단일 배포. `User.role`(MEMBER/ADMIN) 추가,
  `middleware.ts`에서 `/admin/*`은 ADMIN만 통과(그 외 로그인 리다이렉트).
- **KCP 연동**: **포트원(PortOne) V2 경유**. KCP를 포트원 콘솔에서 채널로 연결하고,
  프론트는 `@portone/browser-sdk`의 `requestPayment()`로 결제창 호출,
  서버는 `@portone/server-sdk`로 **결제 단건 조회(getPayment)로 승인·금액 검증** + 웹훅 대사.
  결제 금액은 항상 서버 DB의 주문 금액과 대조(위변조 방지). 개발은 포트원 **테스트 채널**
  (KCP 테스트 MID 연결), storeId/channelKey/API secret은 `.env` 분리.
  수단 매핑: 카드=`CARD`, 계좌이체=`TRANSFER`, 간편결제=`EASY_PAY`.
- **파일 저장**: dev는 `public/uploads/` 로컬 저장. `lib/storage.ts` 인터페이스로
  격리해 배포 시 S3류 교체 가능.

## 2. 데이터 모델 추가/변경 (커머스 v1 스키마 위에 additive migration)

```
User      += role String @default("MEMBER")   // MEMBER | ADMIN
          변경: status 를 가입 승인제로 활용 (PENDING → APPROVED/REJECTED)

Order.status 확장:
  PENDING_PAYMENT → PAID → PREPARING → SHIPPED → DELIVERED
  (+ CANCELED, PAYMENT_FAILED)

Payment (신규):  // 포트원 V2 기준
  id, orderId(unique), paymentId(포트원 결제 식별자 = 우리가 발급),
  pgTxId(포트원/PG 거래번호), channel("kcp"),
  method(CARD|TRANSFER|EASY_PAY), amount,
  status(READY|PAID|CANCELED|FAILED),
  approvedAt, canceledAt, rawResponse(String, JSON 원문 — 정산/분쟁 대비)

Banner (신규):   eyebrow, title, subtitle, primaryLabel/primaryHref,
                 secondaryLabel/secondaryHref, sortOrder, active
Notice (신규):   kind(notice|stock|event), title, body, active, createdAt
Product += image(업로드 경로) — 기존 필드 활용
```

→ 메인 히어로/공지 스트립을 목데이터 대신 **DB(Banner/Notice)** 에서 읽도록 전환.

## 3. 결제 플로우

```
[체크아웃 제출]
  서버: Order 생성 (status=PENDING_PAYMENT) + paymentId 발급, 금액 고정
  프론트: PortOne.requestPayment({ storeId, channelKey, paymentId,
          orderName, totalAmount, currency:"CURRENCY_KRW", payMethod })
  결제창 완료: 브라우저가 서버 /api/payments/complete 로 paymentId 전달
  서버: server-sdk getPayment(paymentId)
    status=PAID & amount.total==주문금액 → Payment(PAID)+Order=PAID+장바구니 비움
    불일치/실패 → Order=PAYMENT_FAILED (재시도 허용)
[웹훅 /api/payments/webhook]
  포트원 서명 검증(Webhook.verify) → 결제 재조회로 상태 대사(이중확인)
[어드민 결제취소]
  server-sdk cancelPayment(paymentId) → Payment=CANCELED + Order=CANCELED
```

- 금액 검증: 결제창 요청·승인 응답 금액을 서버 주문 금액과 대조(불일치 시 거절).
- v2로 미룸: 부분취소, 에스크로, 현금영수증, 정기결제(빌링).

## 4. 어드민 화면 (`/admin`)

| 메뉴 | 경로 | 기능 |
|---|---|---|
| 대시보드 | `/admin` | 오늘 주문/매출, 신규 회원, 결제실패 건수 |
| 상품 | `/admin/products`, `/new`, `/[id]` | 목록·검색, 등록/수정(티어가격·이미지 업로드), 판매상태 토글 |
| 주문 | `/admin/orders`, `/[id]` | 상태 필터, 상세(결제정보), 상태변경(배송처리), 결제취소 |
| 회원 | `/admin/members`, `/[id]` | 목록·검색, 상세, 승인/반려 |
| 배너 | `/admin/banners` | 히어로 슬라이드 CRUD, 순서/노출 |
| 공지 | `/admin/notices` | 공지/입고/이벤트 CRUD, 노출 |

- 레이아웃: 좌측 사이드바 내비 + 테이블 중심(정보밀도 높은) 관리 UI. 브랜드 톤 유지.
- 가드: `requireAdmin()`(role=ADMIN). 시드에 admin 계정 추가.

## 5. 가입 승인제 전환

- 회원가입 시 `status=PENDING` 생성(기존 자동 APPROVED에서 변경).
- 로그인은 되지만 PENDING이면 "승인 대기" 안내, 주문/장바구니 차단.
- 어드민 회원관리에서 승인(APPROVED)/반려(REJECTED).
- 데모 편의를 위해 시드 데모 회원은 APPROVED로 생성.

## 6. 구현 순서

1. **커머스 v1** (기존 25태스크 계획) — 선행. Prisma·인증·상품·장바구니·주문.
2. 어드민 기반: `role` 마이그레이션, `requireAdmin`, `/admin` 레이아웃/사이드바.
3. 관리 기능: 상품 → 주문 → 회원 → 배너/공지, 메인이 Banner/Notice 읽도록 전환.
4. KCP 테스트 연동: 결제창 → 승인 API → Payment/Order 상태, 노티 수신.
5. 결제 취소(어드민) + 금액 대사.

## 7. 비범위 (v1)

부분취소·에스크로·현금영수증·정기결제, 정산 리포트, 관리자 권한 세분화(역할별 ACL),
이미지 CDN, 실 상점코드 운영 설정.

## 8. 리스크 / 메모

- KCP 서명키/상점코드는 절대 커밋 금지 — `.env`(+ `.env.example` 템플릿만 커밋).
- 승인/취소는 반드시 서버에서. 클라이언트 금액을 신뢰하지 않음.
- 결제 원문(rawResponse) 보존해 정산·분쟁 대응.
- KCP 테스트 연동은 실제 카드 승인 없이 테스트 상점코드로 진행.
