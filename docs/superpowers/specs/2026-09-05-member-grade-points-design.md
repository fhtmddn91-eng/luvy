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

---

# 추가 (같은 날 확정): 결제 시 사용 · 만료 · 자동 승급

## 데이터 추가
- `Order.pointsUsed Int @default(0)` — 결제금액 = subtotal + shippingFee − pointsUsed.
- `PointLedger.remaining Int @default(0)` (양수 행 = "묶음(lot)"의 남은 양), `PointLedger.expiresAt DateTime?`.
  kind 추가: `USE`(주문 사용) · `REFUND`(취소·결제실패 환급) · `EXPIRE`(만료 소멸).
- `User.gradeLocked Boolean @default(false)` — 수동 고정(자동 승급 제외).
- `MemberGrade.threshold Int @default(0)` — 누적 결제확인 구매금액 기준.
- Setting: `point_min_use`(기본 1000) · `point_use_unit`(100) · `point_expiry_months`(12, 0 = 만료 없음).

## 불변식
- `User.pointBalance == Σ ledger.amount == Σ lot.remaining` — 세 값은 항상 같은 트랜잭션에서 움직인다.
  잔액은 음수가 되지 않는다(회수는 가용 잔액까지만, 부족분은 사유에 적는다).
- 사용·차감·회수·만료는 **먼저 만료되는 묶음부터**(expiresAt 오름차순, 없는 것은 뒤) 소진한다.

## 결제 시 사용
- 검사(순수 함수 `validatePointUse`): 0 이면 통과. 아니면 unit 배수 · minUse 이상 · 잔액 이하 · 총액(배송비 포함) 이하.
- 주문 트랜잭션: 재고 선점 → 만료 정리 → USE 소진(잔액 부족이면 예외 → 전체 롤백) → 주문 생성.
- 총액 0원: 무통장·PG 모두 결제 절차 없이 PREPARING + depositConfirmedBy "POINTS".
- 환급: 취소(`claimCancel`)·결제실패(`finalizePayment`)에서 USE 가 있고 REFUND 가 없으면 같은 액수를
  **새 묶음**으로 환급(만료 = 환급일 + 정책 개월). (orderId, kind) unique 로 1회.
- 적립 기준액 = max(0, subtotal − pointsUsed).

## 만료
- 묶음 생성 시 `expiresAt = 생성일 + 개월`(정책 0 이면 null). 정책 변경은 그 뒤 묶음부터.
- `expirePoints(userId)`: remaining>0 && expiresAt<=now 인 묶음마다 EXPIRE 행(−remaining) + remaining=0.
  호출 자리: 주문 트랜잭션 · 마이페이지 · 어드민 회원 상세 · 어드민 회원 목록(전체 sweep).
- 30일 내 소멸 예정 합계를 마이페이지·어드민 상세에 표시.

## 자동 승급
- `gradeFor(spent, grades)`: threshold ≤ spent 인 등급 중 가장 높은 것. **올라가기만** 한다.
- 시점: 배송완료 전환(적립 직후) + 설정의 「전체 회원 지금 재평가」. `gradeLocked` 면 건너뛴다.
- 감사 로그 `MEMBER_GRADE` (summary 에 "자동 승급" 표기).
