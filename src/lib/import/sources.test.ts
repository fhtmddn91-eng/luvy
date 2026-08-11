import { describe, it, expect } from "vitest";
import { SOURCES, sourceForHost, sourceForUrl, sourceById } from "./sources";

describe("sources — 도매처 판별", () => {
  it("등록된 도매처를 호스트로 찾는다 (www·m 서브도메인 포함)", () => {
    expect(sourceForHost("detail.1688.com")?.id).toBe("1688");
    expect(sourceForHost("m.doradora.kr")?.id).toBe("doradora");
    expect(sourceForHost("m.pinkboxb2b.com")?.id).toBe("pinkbox");
    expect(sourceForHost("0625.co.kr")?.id).toBe("lovemall");
    expect(sourceForHost("dome2.oxox.co.kr")?.id).toBe("ribos");
    expect(sourceForHost("redgroup.co.kr")?.id).toBe("redgroup");
  });

  it("모르는 사이트는 null — 아무 데서나 수집되지 않는다", () => {
    expect(sourceForHost("example.com")).toBeNull();
    expect(sourceForUrl("https://evil.com/product")).toBeNull();
    expect(sourceForUrl("그냥문자열")).toBeNull();
  });

  it("도메인 끝을 정확히 본다 (유사 도메인 차단)", () => {
    // "1688.com.evil.com" 같은 걸 1688 로 오인하면 안 된다
    expect(sourceForHost("1688.com.evil.com")).toBeNull();
    expect(sourceForHost("notdoradora.kr")).toBeNull();
  });

  it("국내 도매처는 번역을 태우지 않는다 (이미 한국어)", () => {
    expect(sourceById("1688")?.translate).toBe(true);
    for (const id of ["doradora", "pinkbox", "lovemall", "ribos", "redgroup"]) {
      expect(sourceById(id)?.translate).toBe(false);
      expect(sourceById(id)?.currency).toBe("KRW");
    }
  });

  it("Cafe24 3사는 cafe24 이미지 CDN 을 허용한다", () => {
    for (const id of ["doradora", "pinkbox", "lovemall"]) {
      expect(sourceById(id)!.imageHost.test("image.cafe24img.com")).toBe(true);
    }
    // 다른 도매처 CDN 은 열어주지 않는다
    expect(sourceById("ribos")!.imageHost.test("image.cafe24img.com")).toBe(false);
  });

  it("id 는 중복되지 않는다", () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });
});
