/**
 * 어드민 목록 → 수정 → 저장 뒤 "원래 보던 목록 페이지"로 돌아가기 위한 주소 검증.
 *
 * 실사례(2026-09-05 운영자 요청서 5번): 상품 목록 5페이지에서 상품을 열어 저장하면
 * 무조건 1페이지로 떨어져 매번 다시 넘겨야 했다. 돌아갈 주소는 주소창에서 오므로
 * 외부 주소로 튕기는(open redirect) 통로가 되지 않게 여기서 거른다.
 */
import { describe, it, expect } from "vitest";
import { safeAdminReturnPath } from "./adminReturnPath";

describe("safeAdminReturnPath — 목록 복귀 주소 거르기", () => {
  it("목록 주소에 페이지·검색이 붙은 상대 경로는 그대로 통과", () => {
    expect(safeAdminReturnPath("/admin/products?page=5&per=50&q=진동", "/admin/products")).toBe(
      "/admin/products?page=5&per=50&q=진동",
    );
    expect(safeAdminReturnPath("/admin/products", "/admin/products")).toBe("/admin/products");
  });

  it("비어 있거나 없으면 기본 목록으로", () => {
    expect(safeAdminReturnPath(undefined, "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("   ", "/admin/products")).toBe("/admin/products");
  });

  it("다른 경로·외부 주소·프로토콜 상대 주소는 거부하고 기본 목록으로", () => {
    expect(safeAdminReturnPath("https://evil.example/", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("//evil.example/admin/products", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("/admin/orders?page=2", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("/admin/productsx", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("admin/products", "/admin/products")).toBe("/admin/products");
  });

  it("개행·제어문자·역슬래시가 섞이면 거부 — 헤더 주입·브라우저 정규화 우회 차단", () => {
    expect(safeAdminReturnPath("/admin/products?page=2\r\nX: y", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("/admin/products\\@evil.example", "/admin/products")).toBe("/admin/products");
  });

  it("하위 경로(상품 상세)로는 안 돌아간다 — 목록 화면과 그 쿼리만 허용", () => {
    expect(safeAdminReturnPath("/admin/products/abc123", "/admin/products")).toBe("/admin/products");
    expect(safeAdminReturnPath("/admin/products/new", "/admin/products")).toBe("/admin/products");
  });
});
