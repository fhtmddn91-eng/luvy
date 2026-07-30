import { describe, it, expect, afterAll } from "vitest";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { saveImageBuffer, saveImageUpload, saveBizCertUpload, deleteImageUpload } from "./storage";

/**
 * 1688 상세이미지에는 움직이는 GIF가 섞여 있다.
 * 미러링 과정에서 정적 이미지로 바뀌거나 확장자가 틀어지면 판매자료로 못 쓰므로
 * 바이트가 그대로 보존되는지 확인한다.
 */

// 2프레임 + NETSCAPE 루프 확장을 가진 최소 애니메이션 GIF
const ANIMATED_GIF = Buffer.from(
  "R0lGODlhCgAKAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQECgAAACwAAAAACgAKAAACB4SPqcvtDwUAIfkEBAoAAAAsAAAAAAoACgAAAgeEj6nL7Q8FADs=",
  "base64",
);

const written: string[] = [];

afterAll(async () => {
  await Promise.all(
    written.map((url) => unlink(path.join(process.cwd(), "public", url)).catch(() => {})),
  );
});

describe("saveImageBuffer", () => {
  it("애니메이션 GIF를 .gif 로 저장하고 바이트를 그대로 보존한다", async () => {
    const res = await saveImageBuffer(ANIMATED_GIF, "image/gif");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    written.push(res.url);

    expect(res.url.endsWith(".gif")).toBe(true);

    const disk = await readFile(path.join(process.cwd(), "public", res.url));
    // 원본과 완전히 동일해야 한다 (재인코딩·정적화 없음)
    expect(disk.equals(ANIMATED_GIF)).toBe(true);
    // GIF89a 헤더와 루프 확장이 살아 있는지
    expect(disk.subarray(0, 6).toString("ascii")).toBe("GIF89a");
    expect(disk.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  });

  it("이미지가 아닌 MIME은 거부한다", async () => {
    const res = await saveImageBuffer(Buffer.from("<script>x</script>"), "text/html");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("지원하지 않는");
  });

  it("빈 데이터를 거부한다", async () => {
    const res = await saveImageBuffer(Buffer.alloc(0), "image/png");
    expect(res.ok).toBe(false);
  });

  it("용량 상한을 넘기면 거부한다", async () => {
    const res = await saveImageBuffer(Buffer.alloc(1024), "image/png", 512);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("너무 큽니다");
  });
});

/* ── 위장 파일 차단 ─────────────────────────────────────
 * 업로드 검증은 브라우저가 보내는 file.type 을 믿지 않고 내용을 확인해야 한다.
 * 이 테스트가 깨지면 위장 파일이 서버에 저장된다는 뜻이다.
 */
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const REAL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(30).fill(0),
]);
const REAL_PDF = new Uint8Array([...ascii("%PDF-1.7"), ...new Array(30).fill(0)]);
// Buffer 로 감싸 BlobPart 타입 요구를 만족시킨다
const asFile = (name: string, type: string, bytes: Uint8Array) =>
  new File([Buffer.from(bytes)], name, { type });

describe("saveImageUpload — 위장 파일 차단", () => {
  it("HTML 을 image/png 로 선언해도 거부한다", async () => {
    const r = await saveImageUpload(
      asFile("evil.png", "image/png", ascii("<html><script>alert(1)</script></html>")),
    );
    expect(r.ok).toBe(false);
  });

  it("SVG(스크립트 삽입 가능)를 이미지로 위장해도 거부한다", async () => {
    const r = await saveImageUpload(asFile("x.png", "image/png", ascii("<svg onload=alert(1)>")));
    expect(r.ok).toBe(false);
  });

  it("PHP 웹셸을 이미지로 위장해도 거부한다", async () => {
    const r = await saveImageUpload(
      asFile("shell.png", "image/png", ascii("<?php system($_GET[0]); ?>")),
    );
    expect(r.ok).toBe(false);
  });

  it("내용은 PDF 인데 image/png 로 선언하면 거부한다", async () => {
    const r = await saveImageUpload(asFile("a.png", "image/png", REAL_PDF));
    expect(r.ok).toBe(false);
  });

  it("허용 목록에 없는 MIME(SVG)은 애초에 거부한다", async () => {
    const r = await saveImageUpload(asFile("a.svg", "image/svg+xml", ascii("<svg/>")));
    expect(r.ok).toBe(false);
  });

  it("정상 PNG 는 저장된다", async () => {
    const r = await saveImageUpload(asFile("real.png", "image/png", REAL_PNG));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url).toMatch(/^\/uploads\/.+\.png$/);
      await deleteImageUpload(r.url);
    }
  });
});

describe("saveBizCertUpload — 사업자등록증", () => {
  it("가짜 PDF 는 거부한다", async () => {
    const r = await saveBizCertUpload(asFile("cert.pdf", "application/pdf", ascii("not a pdf")));
    expect(r.ok).toBe(false);
  });
});
