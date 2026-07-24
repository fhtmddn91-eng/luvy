/** 문의 유형: 1:1 일반 / 입점 / 대량구매 / 제휴 */
export const INQUIRY_TYPES = {
  GENERAL: "1:1 문의",
  PARTNER_APPLY: "입점 문의",
  BULK: "대량구매 상담",
  ALLIANCE: "제휴 제안",
} as const;

export type InquiryType = keyof typeof INQUIRY_TYPES;
