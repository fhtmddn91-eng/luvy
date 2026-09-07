import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicOriginFrom } from "./publicOrigin";

const H = (o: Record<string, string>) => new Headers(o);
const saved = process.env.NEXT_PUBLIC_SITE_URL;
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = saved;
});

describe("publicOriginFrom — 프록시 뒤에서 바깥 주소 복원", () => {
  it("Railway 프록시: x-forwarded-* 가 있으면 내부 host 를 무시한다", () => {
    // 실사례: host 는 localhost:8080 인데 손님이 보는 주소는 luvyb2b.com
    const h = H({ host: "localhost:8080", "x-forwarded-host": "luvyb2b.com", "x-forwarded-proto": "https" });
    expect(publicOriginFrom(h)).toBe("https://luvyb2b.com");
  });

  it("forwarded 헤더가 없으면 host 를 쓰고, localhost 는 http 로", () => {
    expect(publicOriginFrom(H({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(publicOriginFrom(H({ host: "luvyb2b.com" }))).toBe("https://luvyb2b.com");
  });

  it("프록시가 여러 단이면 첫 값만 쓴다", () => {
    const h = H({ "x-forwarded-host": "luvyb2b.com, internal.proxy", "x-forwarded-proto": "https, http" });
    expect(publicOriginFrom(h)).toBe("https://luvyb2b.com");
  });

  it("NEXT_PUBLIC_SITE_URL 이 있으면 헤더보다 우선하고 끝 슬래시를 뗀다", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://luvyb2b.com/";
    const h = H({ host: "evil.example", "x-forwarded-host": "evil.example" });
    expect(publicOriginFrom(h)).toBe("https://luvyb2b.com");
  });

  it("아무 헤더도 없으면 운영 주소로 떨어진다", () => {
    expect(publicOriginFrom(new Headers())).toBe("https://luvyb2b.com");
  });
});
