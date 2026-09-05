/**
 * 어드민 목록 → 수정 → 저장 뒤 돌아갈 주소 거르기.
 *
 * 실사례(2026-09-05 운영자 요청서 5번): 상품 목록 5페이지에서 상품을 열어 저장하면
 * 무조건 1페이지로 떨어져 매번 다시 넘겨야 했다. 그래서 목록이 자기 주소를
 * `?back=` 으로 실어 보내고 저장 뒤 그리로 돌아간다.
 *
 * 이 값은 주소창에서 오므로 사람이 고칠 수 있다. 외부 주소로 튕기는(open redirect)
 * 통로가 되지 않게 **목록 경로 자신 + 쿼리**만 허용한다:
 * - `//evil` 은 프로토콜 상대 주소라 브라우저가 외부로 보낸다 → `/` 한 글자 뒤에 `/` 금지
 * - 역슬래시는 일부 브라우저가 `/` 로 정규화한다 → 거부
 * - 개행·제어문자는 Location 헤더 주입 → 거부
 * - 하위 경로(`/admin/products/abc`)는 "목록으로 돌아가기"가 아니다 → 거부
 */
export function safeAdminReturnPath(raw: string | undefined | null, listPath: string): string {
  const s = (raw ?? "").trim();
  if (!s) return listPath;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(s)) return listPath;
  if (s === listPath) return s;
  if (!s.startsWith(listPath + "?")) return listPath;
  return s;
}
