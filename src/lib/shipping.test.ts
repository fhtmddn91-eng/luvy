import { describe, it, expect } from "vitest";
import {
  COURIERS,
  courierName,
  isCourierCode,
  normalizeTrackingNo,
  isValidTrackingNo,
  hasShipment,
  trackingUrl,
  shouldAdvanceToShipped,
} from "./shipping";

describe("normalizeTrackingNo", () => {
  it("공백과 하이픈을 제거한다", () => {
    expect(normalizeTrackingNo("1234-5678-9012")).toBe("123456789012");
    expect(normalizeTrackingNo(" 6012 3456 7890 ")).toBe("601234567890");
  });

  it("영문은 대문자로 통일한다", () => {
    expect(normalizeTrackingNo("ee123456789kr")).toBe("EE123456789KR");
  });
});

describe("isValidTrackingNo", () => {
  it("정규화 후 영숫자 8~20자리를 통과시킨다", () => {
    expect(isValidTrackingNo("1234567890")).toBe(true);
    expect(isValidTrackingNo("1234-5678-9012")).toBe(true);
    expect(isValidTrackingNo("EE123456789KR")).toBe(true);
  });

  it("너무 짧거나 특수문자가 섞이면 거부한다", () => {
    expect(isValidTrackingNo("1234")).toBe(false);
    expect(isValidTrackingNo("")).toBe(false);
    expect(isValidTrackingNo("123456789012345678901")).toBe(false); // 21자리
    expect(isValidTrackingNo("1234567/89")).toBe(false);
    expect(isValidTrackingNo("송장번호없음")).toBe(false);
  });
});

describe("courier 목록", () => {
  it("코드가 중복되지 않는다", () => {
    const codes = COURIERS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("이름을 코드로 찾을 수 있고, 모르는 코드는 그대로 돌려준다", () => {
    expect(courierName("CJ")).toBe("CJ대한통운");
    expect(courierName("UNKNOWN")).toBe("UNKNOWN");
    expect(isCourierCode("CJ")).toBe(true);
    expect(isCourierCode("FAKE")).toBe(false);
  });
});

describe("hasShipment", () => {
  it("택배사와 번호가 모두 있어야 배송 정보로 인정한다", () => {
    expect(hasShipment({ courier: "CJ", trackingNo: "1234567890" })).toBe(true);
    expect(hasShipment({ courier: "CJ", trackingNo: "" })).toBe(false);
    expect(hasShipment({ courier: "", trackingNo: "1234567890" })).toBe(false);
  });
});

describe("trackingUrl", () => {
  it("택배사 조회 페이지에 번호를 붙여준다", () => {
    expect(trackingUrl({ courier: "CJ", trackingNo: "1234567890" })).toBe(
      "https://trace.cjlogistics.com/next/tracking.html?wblNo=1234567890",
    );
    expect(trackingUrl({ courier: "LOGEN", trackingNo: "1234567890" })).toBe(
      "https://www.ilogen.com/web/personal/trace/1234567890",
    );
  });

  it("하이픈이 섞여 저장돼도 정규화된 번호로 링크를 만든다", () => {
    expect(trackingUrl({ courier: "CJ", trackingNo: "1234-5678-90" })).toContain("wblNo=1234567890");
  });

  it("조회 링크가 없는 택배사(기타)는 null", () => {
    expect(trackingUrl({ courier: "ETC", trackingNo: "1234567890" })).toBeNull();
  });

  it("배송 정보가 없거나 번호가 잘못되면 null (링크 대신 번호만 표시)", () => {
    expect(trackingUrl({ courier: "", trackingNo: "" })).toBeNull();
    expect(trackingUrl({ courier: "CJ", trackingNo: "123" })).toBeNull();
    expect(trackingUrl({ courier: "FAKE", trackingNo: "1234567890" })).toBeNull();
  });

  it("모든 조회 링크는 https 이고 번호를 포함한다", () => {
    for (const c of COURIERS.filter((c) => c.trackUrl)) {
      const url = trackingUrl({ courier: c.code, trackingNo: "1234567890" });
      expect(url, c.code).toMatch(/^https:\/\//);
      expect(url, c.code).toContain("1234567890");
    }
  });
});

describe("shouldAdvanceToShipped", () => {
  it("배송 전 상태에서 송장을 넣으면 배송중으로 올린다", () => {
    expect(shouldAdvanceToShipped("RECEIVED")).toBe(true);
    expect(shouldAdvanceToShipped("PREPARING")).toBe(true);
    expect(shouldAdvanceToShipped("PAID")).toBe(true);
  });

  it("이미 배송중·완료·취소인 주문의 상태는 건드리지 않는다", () => {
    expect(shouldAdvanceToShipped("SHIPPED")).toBe(false);
    expect(shouldAdvanceToShipped("DELIVERED")).toBe(false);
    expect(shouldAdvanceToShipped("CANCELED")).toBe(false);
    expect(shouldAdvanceToShipped("PAYMENT_FAILED")).toBe(false);
  });
});
