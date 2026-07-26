export const MEMBER_STATUS: Record<string, { label: string; tone: string }> = {
  // 승인 대기만 브랜드 로즈로 시선을 잡고, 나머지는 모노크롬
  PENDING: { label: "승인 대기", tone: "bg-brand-500 text-white" },
  APPROVED: { label: "승인됨", tone: "bg-ink-deep text-white" },
  REJECTED: { label: "반려", tone: "bg-hairline-soft text-muted" },
};

export const memberStatusLabel = (s: string): string => MEMBER_STATUS[s]?.label ?? s;
export const memberStatusTone = (s: string): string =>
  MEMBER_STATUS[s]?.tone ?? "bg-hairline-soft text-muted";
