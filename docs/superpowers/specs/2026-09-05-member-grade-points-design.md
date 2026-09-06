# 회원 구매금액·등급·포인트 (묶음 B) — 설계

2026-09-05. 운영자 요청서 1·2·3번. 채택 기준(대화 확정): 등급은 **관리자 수동**,
등급의 역할은 **적립률만**, 결제 시 포인트 사용은 **이번 범위 밖**.

## 데이터

```prisma
model MemberGrade {
  code        String @id          // BASIC | SILVER | GOLD (코드 고정, 이름은 편집)
  name        String              // 일반 · 우수 · VIP
  pointRateBp Int    @default(0)  // 적립률 만분율 (100 = 1%) — 소수 % 를 정수로
  sortOrder   Int    @default(0)
  users       User[]
}
User  { gradeCode String @default("BASIC"); pointBalance Int @default(0) }
model PointLedger {
  id        String   @id @default(cuid())
  userId    String
  amount    Int                   // +적립 / −회수·차감
  kind      String                // ACCRUE | REVERSE | ADJUST
  reason    String   @default("")
  orderId   String?
  createdBy String   @default("") // SYSTEM 또는 관리자 id
  createdAt DateTime @default(now())
  @@unique([orderId, kind])       // 주문당 적립 1회 · 회수 1회 (ADJUST 는 orderId null)
  @@index([userId, createdAt])
}
```
마이그레이션은 추가만. 등급 3행을 SQL 로 심는다(일반 0% · 우수 1% · VIP 2%). 기존 회원은 BASIC.
`pointBalance` 는 원장 합계의 캐시 — 원장 기록과 같은 트랜잭션에서 갱신한다.

## 1. 구매금액

- **집계 기준**: 결제가 확인된 주문 = status ∈ {PAID, PREPARING, SHIPPED, DELIVERED}, 금액은 `total`.
  접수됨(무통장 미입금)·취소·실패는 빠진다. (대시보드 매출은 접수됨을 포함해 더 크다 — 의도된 차이)
- **회원 목록**: 「구매금액」 열 추가. 기간 탭 `?period=all|month|week|today` (전체·이번 달·이번 주·오늘),
  `?sort=spent` 로 금액순. 기본은 지금처럼 가입일순. 주는 월요일 시작.
- **회원 상세**: `?view=month|week|day` — 월별 최근 12개월 · 주별 최근 12주 · 일별 최근 30일 표
  (기간 · 주문 수 · 금액). 빈 기간도 0 으로 채운다. 위에 누적 합계.
- 순수 함수: `periodStart(period, now)`, `bucketOrders(orders, view, now)` — 단위 테스트.

## 2. 등급

- 회원 상세에 등급 select + 저장 → `setMemberGrade`. 감사 로그 `MEMBER_GRADE`.
- 목록·상세·마이페이지에 등급 이름 표시. 신규 가입은 BASIC.
- 어드민 「설정」에 「회원 등급·적립률」 패널: 등급마다 이름·적립률(%) 편집 → `updateMemberGrades`.
  적립률은 0~100, 소수 둘째 자리까지(만분율 저장). 감사 로그 `SETTING_GRADES`.

## 3. 포인트

- **적립**: `setOrderStatus` 가 DELIVERED 로 바꿀 때 `accruePointsForOrder(orderId)`.
  기준액 `subtotal`(배송비 제외) × 그 시점 회원 등급의 적립률, 원 미만 버림. 0원이면 기록 안 함.
  같은 주문 재적립은 unique 로 막힌다(배송완료 → 되돌림 → 다시 배송완료).
- **회수**: `cancelOrderCore` 의 취소 트랜잭션 안에서 적립 기록이 있으면 −같은 액수 REVERSE.
- **수동 조정**: 회원 상세에 지급/차감 폼(금액·사유) → `adjustMemberPoints`. 잔액이 음수가 되는 차감은 거부.
  감사 로그 `POINT_ADJUST`.
- **표시**: 회원 상세에 잔액 + 내역(최근 30건). 마이페이지 카드에 등급·잔액, 아래에 내역 10건.
- 순수 함수: `pointsFor(subtotal, rateBp)`, `parseRatePercent(input)` — 단위 테스트.

## 하지 않는 것
결제 시 포인트 사용, 자동 승급, 포인트 만료, 회원 알림.
