/**
 * 손님 브라우저가 보는 우리 주소(origin).
 *
 * 운영은 Railway 프록시 뒤에서 도는데, 그 안에서 `req.url` 은 **내부 주소**
 * (http://localhost:8080)다. 실측(2026-09-07): 나이스페이 returnUrl 라우트가
 * `new URL(path, req.url)` 로 redirect 를 만들어 손님을 `https://localhost:8080/checkout`
 * 으로 보냈다 — 결제가 끝난 손님이 죽은 페이지에 떨어지는 사고. 프록시가 붙여주는
 * x-forwarded-host / x-forwarded-proto 로 바깥 주소를 복원한다.
 *
 * NEXT_PUBLIC_SITE_URL 이 있으면 그걸 최우선으로 쓴다 — 헤더는 요청자가 보내는 값이라,
 * 고정 주소가 있으면 그쪽이 더 안전하다.
 */
export function publicOriginFrom(h: Headers): string {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (fixed) return fixed.replace(/\/+$/, "");

  // 프록시가 여러 단이면 "a, b" 처럼 오므로 첫 값만 쓴다
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host")) ?? "luvyb2b.com";
  const proto = first(h.get("x-forwarded-proto")) ?? (/^localhost(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
