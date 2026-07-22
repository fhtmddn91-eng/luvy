export const MEMBER_STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "승인 대기", tone: "bg-brand-100 text-brand-700" },
  APPROVED: { label: "승인됨", tone: "bg-brand-500 text-white" },
  REJECTED: { label: "반려", tone: "bg-line text-muted" },
};

export const memberStatusLabel = (s: string): string => MEMBER_STATUS[s]?.label ?? s;
export const memberStatusTone = (s: string): string => MEMBER_STATUS[s]?.tone ?? "bg-line text-muted";
