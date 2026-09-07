/**
 * 주문서에서 고를 수 있는 결제 수단 (순수 모듈 — 클라이언트·서버 양쪽에서 쓴다).
 *
 * 열림/닫힘은 두 층이다:
 *  · `ready: false` — 코드 자체가 없다. 화면에 '준비 중'으로 보이고 못 고른다.
 *  · `requires`     — 코드는 있지만 **환경변수(키)가 있어야** 열린다. 키가 빠지면
 *                     자동으로 닫힌다 — 배포·코드 수정 없이 Railway 변수만 지우면 끊긴다.
 *
 * 열림 판정에 필요한 "지금 무엇이 설정돼 있는가"(Availability)는 서버만 안다.
 * 서버가 계산해 화면에 내려주고, 서버 액션은 같은 표로 다시 검사한다.
 *
 * 라벨을 "무엇으로 내는지"(신용카드·간편결제)로 잡고 PG사명을 아래 줄에 병기한 이유:
 * 사는 사람은 나이스페이와 KCP 의 차이를 모른다. PG사명만 두 개 나란히 있으면
 * "뭘 눌러야 하지"에서 멈춘다.
 */
export interface PaymentMethod {
  value: string;
  /** 버튼에 크게 보이는 이름 — 결제 방식 */
  label: string;
  /** 작게 붙는 보조 설명 — PG사명 또는 안내 */
  hint: string;
  /** false 면 '준비 중'으로 표시되고 선택할 수 없다 */
  ready: boolean;
  /** 이 키가 설정돼 있어야 열린다 (Availability 의 키 이름) */
  requires?: keyof Availability;
}

/** 서버가 환경변수를 보고 채우는 "지금 열 수 있는 것" */
export interface Availability {
  nicepay: boolean;
}

export const NO_AVAILABILITY: Availability = { nicepay: false };

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    value: "BANK_TRANSFER",
    label: "무통장 입금",
    hint: "주문 후 안내되는 계좌로 입금",
    ready: true,
  },
  {
    value: "NICEPAY",
    label: "신용카드 결제",
    hint: "나이스페이",
    ready: true,
    requires: "nicepay",
  },
  {
    value: "NHN_KCP",
    label: "간편결제 · 계좌이체",
    hint: "NHN KCP",
    ready: false,
  },
];

/** 이 수단이 지금 열려 있는가 */
export function isMethodOpen(m: PaymentMethod, a: Availability): boolean {
  if (!m.ready) return false;
  if (m.requires && !a[m.requires]) return false;
  return true;
}

/** 지금 실제로 고를 수 있는 수단 */
export const readyMethods = (a: Availability = NO_AVAILABILITY): PaymentMethod[] =>
  PAYMENT_METHODS.filter((m) => isMethodOpen(m, a));

/** 주문서에서 넘어온 값이 지금 받아도 되는 수단인지 */
export function isSelectableMethod(value: string, a: Availability = NO_AVAILABILITY): boolean {
  const m = PAYMENT_METHODS.find((x) => x.value === value);
  return m ? isMethodOpen(m, a) : false;
}

/** 관리자/주문 내역 표기용. 모르는 값이면 값 그대로 돌려준다 */
export function paymentMethodLabel(value: string): string {
  const m = PAYMENT_METHODS.find((x) => x.value === value);
  return m ? m.label : value;
}
