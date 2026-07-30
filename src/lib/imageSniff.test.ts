import { describe, it, expect } from "vitest";
import { sniffImage, matchesMime } from "./imageSniff";

const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(20).fill(0)]);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("sniffImage", () => {
  it("실제 이미지 시그니처를 알아본다", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImage(ascii("GIF89a...................."))).toBe("gif");
    expect(sniffImage(ascii("%PDF-1.7................."))).toBe("pdf");
  });

  it("webp / avif 는 12바이트째까지 봐야 구분된다", () => {
    const webp = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), 0, 0, 0, 0]);
    expect(sniffImage(webp)).toBe("webp");
    const avif = new Uint8Array([0, 0, 0, 0x20, ...ascii("ftypavif"), 0, 0, 0, 0]);
    expect(sniffImage(avif)).toBe("avif");
  });

  it("HTML/스크립트 파일은 이미지로 인정하지 않는다", () => {
    expect(sniffImage(ascii("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(ascii("<?php system($_GET[c]); ?>"))).toBeNull();
    // SVG 는 스크립트를 품을 수 있어 애초에 허용 목록에 없다
    expect(sniffImage(ascii('<svg onload="alert(1)">'))).toBeNull();
  });

  it("너무 짧은 파일은 판별 불가", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("matchesMime", () => {
  it("선언한 MIME 과 내용이 일치할 때만 통과", () => {
    expect(matchesMime("png", "image/png")).toBe(true);
    expect(matchesMime("jpg", "image/jpeg")).toBe(true);
    // 핵심: HTML 을 image/png 라고 선언한 경우
    expect(matchesMime(null, "image/png")).toBe(false);
    // 내용은 PDF 인데 이미지라고 선언한 경우
    expect(matchesMime("pdf", "image/png")).toBe(false);
  });
});
