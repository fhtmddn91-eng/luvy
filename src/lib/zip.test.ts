import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildZip, crc32, safeEntryName } from "./zip";

const FIXED = new Date(2026, 0, 2, 3, 4, 6);
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

describe("crc32", () => {
  it("표준 체크섬 값을 낸다", () => {
    // 널리 쓰이는 검증 벡터 — 구현이 미묘하게 틀리면 여기서 걸린다
    expect(crc32(bytes("123456789")).toString(16)).toBe("cbf43926");
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("safeEntryName", () => {
  it("경로 구분자를 없애 압축 해제 시 상위 폴더로 빠져나가지 못하게 한다", () => {
    expect(safeEntryName("../../etc/passwd")).toBe("._._etc_passwd");
    expect(safeEntryName("a/b\\c.jpg")).toBe("a_b_c.jpg");
  });

  it("빈 이름은 기본값으로 대체한다", () => {
    expect(safeEntryName("   ")).toBe("file");
  });
});

describe("buildZip", () => {
  it("이름이 겹치면 뒤에 번호를 붙여 덮어쓰기를 막는다", () => {
    const zip = buildZip(
      [
        { name: "a.jpg", data: bytes("1") },
        { name: "a.jpg", data: bytes("2") },
        { name: "a.jpg", data: bytes("3") },
      ],
      FIXED,
    );
    const text = zip.toString("latin1");
    expect(text).toContain("a.jpg");
    expect(text).toContain("a-2.jpg");
    expect(text).toContain("a-3.jpg");
  });

  it("빈 목록도 유효한 zip 을 만든다", () => {
    const zip = buildZip([], FIXED);
    expect(zip.length).toBe(22); // EOCD 만
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });

  it("표준 zip 리더로 풀면 CRC 검사를 통과하고 한글 파일명·내용이 그대로 나온다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "luvy-zip-"));
    const file = path.join(dir, "t.zip");
    writeFileSync(
      file,
      buildZip(
        [
          { name: "대표이미지-01.jpg", data: bytes("hello-main") },
          { name: "상세이미지-01.png", data: bytes("hello-detail") },
        ],
        FIXED,
      ),
    );

    // 파이썬 zipfile 은 규격을 그대로 따르므로 검증 기준으로 쓴다.
    // (macOS 기본 unzip 은 오래된 Info-ZIP 이라 UTF-8 이름을 깨뜨린다)
    const out = execFileSync(
      "python3",
      [
        "-c",
        [
          "import json,sys,zipfile",
          "z=zipfile.ZipFile(sys.argv[1])",
          "assert z.testzip() is None",
          "print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))",
        ].join("\n"),
        file,
      ],
      { encoding: "utf8" },
    );

    expect(JSON.parse(out)).toEqual({
      "대표이미지-01.jpg": "hello-main",
      "상세이미지-01.png": "hello-detail",
    });
  });
});
