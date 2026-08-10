import { describe, it, expect } from "vitest";
import { assetKindFor, nextThumbnail } from "./productAssets";

describe("assetKindFor", () => {
  it("대표 자리에 올리면 MAIN", () => {
    expect(assetKindFor("MAIN", { mime: "image/jpeg" })).toBe("MAIN");
  });

  it("대표 자리에 올린 GIF 도 MAIN 을 유지한다 (썸네일 자리)", () => {
    expect(assetKindFor("MAIN", { mime: "image/gif" })).toBe("MAIN");
  });

  it("상세 자리의 GIF 는 GIF, 나머지는 DETAIL", () => {
    expect(assetKindFor("DETAIL", { mime: "image/gif" })).toBe("GIF");
    expect(assetKindFor("DETAIL", { mime: "image/png" })).toBe("DETAIL");
  });

  it("mime 이 없으면 확장자로 GIF 를 판별한다", () => {
    expect(assetKindFor("DETAIL", { url: "/uploads/a.GIF" })).toBe("GIF");
    expect(assetKindFor("DETAIL", { url: "/uploads/a.jpg" })).toBe("DETAIL");
  });
});

describe("nextThumbnail", () => {
  const main = (url: string) => ({ url, kind: "MAIN" });
  const detail = (url: string) => ({ url, kind: "DETAIL" });

  it("대표이미지가 있으면 첫 대표이미지를 따라간다", () => {
    expect(nextThumbnail("/old.jpg", [detail("/d.jpg"), main("/m.jpg")])).toBe("/m.jpg");
  });

  it("이미 첫 대표이미지와 같으면 바꾸지 않는다", () => {
    expect(nextThumbnail("/m.jpg", [main("/m.jpg"), detail("/d.jpg")])).toBeNull();
  });

  it("대표이미지가 없으면 관리자가 올린 썸네일을 덮어쓰지 않는다", () => {
    // 직접 등록 상품에서 상세 이미지를 올릴 때마다 썸네일이 그 이미지로 바뀌던 문제
    expect(nextThumbnail("/thumb.jpg", [detail("/d1.jpg"), detail("/d2.jpg")])).toBeNull();
  });

  it("썸네일이 비어 있으면 첫 이미지로 채운다", () => {
    expect(nextThumbnail("", [detail("/d1.jpg")])).toBe("/d1.jpg");
    expect(nextThumbnail(null, [detail("/d1.jpg")])).toBe("/d1.jpg");
  });

  it("지금 썸네일인 파일이 사라지면 남은 이미지로 다시 잡는다", () => {
    expect(nextThumbnail("/d1.jpg", [detail("/d2.jpg")], "/d1.jpg")).toBe("/d2.jpg");
  });

  it("사라지는 파일이 썸네일이 아니면 건드리지 않는다", () => {
    expect(nextThumbnail("/thumb.jpg", [detail("/d2.jpg")], "/d1.jpg")).toBeNull();
  });

  it("남은 이미지가 하나도 없으면 썸네일을 비운다", () => {
    expect(nextThumbnail("/d1.jpg", [], "/d1.jpg")).toBe("");
  });
});
