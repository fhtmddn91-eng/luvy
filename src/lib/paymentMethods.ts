/**
 * 주문서에서 고를 수 있는 결제 수단.
 *
 * `ready: false` 는 "화면에는 보이지만 아직 못 고르는" 상태다.
 * PG 연동이 끝나면 그 줄의 ready 를 true 로 바꾸기만 하면 바로 열린다
 * (주문서·검증·관리자 표기가 전부 이 배열 하나를 본다).
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
}

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
    ready: false,
  },
  {
    value: "NHN_KCP",
    label: "간편결제 · 계좌이체",
    hint: "NHN KCP",
    ready: false,
  },
];

/** 지금 실제로 고를 수 있는 수단 */
export const readyMethods = (): PaymentMethod[] => PAYMENT_METHODS.filter((m) => m.ready);

/** 주문서에서 넘어온 값이 지금 받아도 되는 수단인지 */
export function isSelectableMethod(value: string): boolean {
  return PAYMENT_METHODS.some((m) => m.value === value && m.ready);
}

/** 관리자/주문 내역 표기용. 모르는 값이면 값 그대로 돌려준다 */
export function paymentMethodLabel(value: string): string {
  const m = PAYMENT_METHODS.find((x) => x.value === value);
  return m ? m.label : value;
}
