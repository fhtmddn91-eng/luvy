export const MEMBER_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "승인 대기", tone: "bg-[#fdf3e4] text-[#95651a]" },
  APPROVED: { label: "승인됨", tone: "bg-ink-deep text-white" },
  REJECTED: { label: "반려", tone: "bg-hairline-soft text-muted" },
};

export const memberStatusLabel = (s: string): string => MEMBER_STATUS[s]?.label ?? s;
export const memberStatusTone = (s: string): string =>
  MEMBER_STATUS[s]?.tone ?? "bg-hairline-soft text-muted";
