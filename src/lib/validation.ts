export function normalizeBizNumber(input: string): string {
  return input.replace(/\D/g, "");
}

export function isValidBizNumber(input: string): boolean {
  return normalizeBizNumber(input).length === 10;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

/**
 * 로그인 후 이동할 안전한 내부 경로만 허용. 프로토콜-상대(`//`, `/\`) URL은
 * 외부로 나가므로 오픈 리다이렉트 방지를 위해 "/"로 대체한다.
 */
export function safeNextPath(next: string | null | undefined): string {
  const v = (next ?? "").trim();
  if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\")) return v;
  return "/";
}
