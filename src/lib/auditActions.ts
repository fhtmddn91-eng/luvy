/**
 * 감사 로그에 기록할 동작 목록 (순수 모듈 — 화면·서버 양쪽에서 쓴다).
 *
 * 여기 없는 문자열이 들어오면 조회 화면에서 코드가 그대로 보이므로,
 * 새 동작을 계측할 때는 반드시 이 표에 라벨을 추가한다.
 */

export const AUDIT_ACTIONS = {
  // 회원
  MEMBER_APPROVE: "회원 승인",
  MEMBER_REJECT: "회원 반려",
  MEMBER_PENDING: "회원 대기 전환",
  MEMBER_TEMP_PASSWORD: "임시 비밀번호 발급",

  // 주문
  ORDER_STATUS: "주문 상태 변경",
  ORDER_SHIPPING: "송장 등록/수정",
  ORDER_SHIPPING_CLEAR: "송장 삭제",
  ORDER_CANCEL_ADMIN: "주문 취소 (관리자)",
  ORDER_CANCEL_MEMBER: "주문 취소 (회원)",
  ORDER_REFUND_FAILED: "환불 실패",

  // 상품·카탈로그
  PRODUCT_CREATE: "상품 등록",
  PRODUCT_UPDATE: "상품 수정",
  PRODUCT_DELETE: "상품 삭제",
  PRODUCT_STATUS: "상품 판매/숨김 전환",
  PRODUCT_IMPORT: "1688 상품 수집",
  ASSET_ADD: "상세 이미지 추가",
  ASSET_DELETE: "상세 이미지 삭제",
  CATEGORY_CREATE: "카테고리 추가",
  CATEGORY_DELETE: "카테고리 삭제",

  // 설정·시스템
  SETTING_SHIPPING: "배송비 정책 변경",
  SETTING_BANK: "입금 계좌 변경",
  NAV_UPDATE: "상단 메뉴 변경",
  BRANDING_UPDATE: "로고 변경",
  HOME_UPDATE: "메인 상품 탭 변경",
  COMPANY_UPDATE: "사업자·고객센터 정보 변경",
  ADMIN_PASSWORD: "관리자 비밀번호 변경",

  // 인증
  LOGIN_BLOCKED: "로그인 차단 (시도 초과)",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const auditLabel = (action: string): string =>
  (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;

/** 조회 화면 필터용 묶음 */
export const AUDIT_GROUPS: { key: string; label: string; actions: AuditAction[] }[] = [
  {
    key: "member",
    label: "회원",
    actions: ["MEMBER_APPROVE", "MEMBER_REJECT", "MEMBER_PENDING", "MEMBER_TEMP_PASSWORD"],
  },
  {
    key: "order",
    label: "주문",
    actions: [
      "ORDER_STATUS", "ORDER_SHIPPING", "ORDER_SHIPPING_CLEAR",
      "ORDER_CANCEL_ADMIN", "ORDER_CANCEL_MEMBER", "ORDER_REFUND_FAILED",
    ],
  },
  {
    key: "product",
    label: "상품",
    actions: [
      "PRODUCT_CREATE", "PRODUCT_UPDATE", "PRODUCT_DELETE",
      "PRODUCT_STATUS", "PRODUCT_IMPORT", "ASSET_ADD", "ASSET_DELETE",
      "CATEGORY_CREATE", "CATEGORY_DELETE",
    ],
  },
  {
    key: "system",
    label: "설정·인증",
    actions: [
      "SETTING_SHIPPING", "SETTING_BANK", "NAV_UPDATE", "BRANDING_UPDATE", "HOME_UPDATE",
      "COMPANY_UPDATE", "ADMIN_PASSWORD", "LOGIN_BLOCKED",
    ],
  },
];

/** 돈·권한이 걸려 눈에 띄게 표시할 동작 */
const CRITICAL: AuditAction[] = [
  "ORDER_CANCEL_ADMIN", "ORDER_REFUND_FAILED", "MEMBER_TEMP_PASSWORD",
  "ADMIN_PASSWORD", "PRODUCT_DELETE",
  // 입금 계좌 바꿔치기는 곧바로 돈이 새는 사고다 — 눈에 띄게
  "SETTING_BANK",
];

export const isCritical = (action: string): boolean =>
  (CRITICAL as string[]).includes(action);

/** 그룹 key → 해당 action 코드 목록 (없는 key 면 빈 배열) */
export function actionsForGroup(key: string): string[] {
  return AUDIT_GROUPS.find((g) => g.key === key)?.actions.slice() ?? [];
}
