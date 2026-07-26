import { describe, it, expect, afterAll } from "vitest";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { saveImageBuffer } from "./storage";

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
