/**
 * 자체 품번(SKU) 규칙 — 순수 모듈.
 *
 * 운영자가 원하는 대로 붙이되, 엑셀·CSV·주문서에 그대로 실리므로
 * 눈으로 구분되지 않는 값(대소문자만 다른 것, 앞뒤 공백)이 서로 다른
 * 품번으로 저장되지 않게 한 형태로 모은다.
 */

/** 입력 → 저장 형태. 안 쓰면 null (빈 문자열로 두면 unique 제약에 여러 건이 걸린다) */
export function normalizeSku(input: string): string | null {
  const s = input.trim().replace(/\s+/g, "").toUpperCase();
  return s === "" ? null : s;
}

const SKU_RE = /^[A-Z0-9][A-Z0-9._/-]{0,31}$/;

/** 문제가 있으면 사람이 읽을 오류 문구, 없으면 null */
export function skuError(sku: string | null): string | null {
  if (sku === null) return null;
  if (sku.length > 32) return "품번은 32자 이하로 입력해주세요.";
  if (!SKU_RE.test(sku)) {
    return "품번은 영문·숫자로 시작하고 - _ . / 만 함께 쓸 수 있습니다. 예) LV-2601";
  }
  return null;
}

/** 화면 표기용 — 없으면 빈 문자열 */
export const skuLabel = (sku: string | null | undefined): string => sku ?? "";
