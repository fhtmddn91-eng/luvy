/**
 * 이미지 URL 정규화 — 도매처별 호스트 화이트리스트를 적용하는 SSRF 방어 관문.
 *
 * payload 는 외부(브라우저 북마클릿·관리자 붙여넣기)에서 오므로 임의 호스트를
 * 허용하면 서버가 내부망을 긁는 통로가 된다. 1688 전용이던 검사를 국내 도매처까지
 * 열면서, **검사 자체는 이 함수 하나로 유지**한다 — 사이트마다 따로 짜두면
 * 한쪽만 고쳐지고 다른 쪽에 구멍이 남는다.
 *
 * 사이트별로 다른 것은 두 가지뿐이다:
 *   imageHost     — 허용 호스트 (SourceSite.imageHost)
 *   transformPath — 원본 주소로 되돌리는 규칙 (1688 의 리사이즈 접미사 제거 등)
 */

/**
 * img: 레드그룹 이미지 서버(speedgabia)가 확장자를 .img 로 붙인다(실측 —
 * 내용물은 GIF/JPEG). 확장자는 1차 필터일 뿐, 진짜 형식 판정은 미러링 때
 * 매직 바이트로 하므로 (mirror.ts) 넓혀도 임의 파일이 저장되지는 않는다.
 */
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|img)$/i;

/**
 * 프로토콜 보정 → 호스트 검증 → (사이트별 변환) → 확장자 확인.
 * 하나라도 통과하지 못하면 null 이며, 호출부는 이를 "받지 않는다"로 처리한다.
 *
 * 쿼리스트링은 버린다(origin + pathname 만 남김). 같은 이미지가 캐시버스터
 * 파라미터만 달라 여러 번 저장되는 것을 막기 위해서다 — StoredFile.sourceUrl
 * 재사용 판정이 문자열 일치라서, 쿼리를 남기면 중복 다운로드가 된다.
 */
export function normalizeImageUrlFor(
  raw: unknown,
  imageHost: RegExp,
  transformPath?: (url: string) => string,
): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("//")) s = "https:" + s;
  if (s.startsWith("http://")) s = "https://" + s.slice("http://".length);
  if (!s.startsWith("https://")) return null;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!imageHost.test(u.hostname)) return null;

  const base = u.origin + u.pathname;
  const path = transformPath ? transformPath(base) : base;
  return IMAGE_EXT.test(path) ? path : null;
}
