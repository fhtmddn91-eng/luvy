export function normalizeBizNumber(input: string): string {
  return input.replace(/\D/g, "");
}

export function isValidBizNumber(input: string): boolean {
  return normalizeBizNumber(input).length === 10;
}

export function isValidEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}
