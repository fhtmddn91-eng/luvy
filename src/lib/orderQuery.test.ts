import { describe, it, expect } from "vitest";
import {
  parseOrderFilter,
  orderWhere,
  filterQuery,
  orderFilterLabel,
  AWAITING_DEPOSIT,
} from "./orderQuery";

describe("parseOrderFilter", () => {
  it("모르는 상태·잘못된 날짜는 버린다", () => {
    const f = parseOrderFilter({ status: "HACK", q: "  젤 ", from: "어제", to: "2026-13-99" });
    expect(f.status).toBe("ALL");
    expect(f.q).toBe("젤");
    expect(f.from).toBe("");
    expect(f.to).toBe(""); // 13월 99일 — 형식은 맞지만 실존하지 않는 날짜
  });

  it("정상 값은 유지한다", () => {
    const f = parseOrderFilter({ status: "SHIPPED", q: "CMS2", from: "2026-07-01", to: "2026-07-27" });
    expect(f).toEqual({ status: "SHIPPED", q: "CMS2", from: "2026-07-01", to: "2026-07-27" });
  });

  it("검색어는 80자로 자른다", () => {
    expect(parseOrderFilter({ q: "a".repeat(200) }).q).toHaveLength(80);
  });
});

describe("orderWhere", () => {
  it("주문번호 검색은 소문자로, 송장 검색은 정규화해서 비교한다", () => {
    const w = orderWhere(parseOrderFilter({ q: "CMS2-HDWA" }));
    const ors = w.OR!;
    expect(ors[0]).toEqual({ id: { contains: "cms2-hdwa" } });
    expect(ors[2]).toEqual({ trackingNo: { contains: "CMS2HDWA" } });
  });

  it("to 날짜는 그날 자정까지 포함한다", () => {
    const w = orderWhere(parseOrderFilter({ from: "2026-07-01", to: "2026-07-27" }));
    const range = w.createdAt as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe(new Date("2026-07-01T00:00:00+09:00").toISOString());
    expect(range.lt.toISOString()).toBe(new Date("2026-07-28T00:00:00+09:00").toISOString());
  });

  it("빈 필터는 빈 where", () => {
    expect(orderWhere(parseOrderFilter({}))).toEqual({});
  });
});

describe("filterQuery", () => {
  it("기본값은 쿼리스트링에서 뺀다", () => {
    expect(filterQuery(parseOrderFilter({}))).toBe("");
    expect(filterQuery(parseOrderFilter({ status: "SHIPPED", q: "젤" }))).toBe(
      "?status=SHIPPED&q=%EC%A0%A4",
    );
  });

  it("override 로 탭 이동 시 검색 조건이 유지된다", () => {
    const f = parseOrderFilter({ q: "젤", from: "2026-07-01" });
    expect(filterQuery(f, { status: "CANCELED" })).toContain("status=CANCELED");
    expect(filterQuery(f, { status: "CANCELED" })).toContain("from=2026-07-01");
  });
});

describe("입금대기 가상 필터", () => {
  it("탭 값으로 받아들인다 (ORDER_STATUS 에 없는 코드지만)", () => {
    expect(parseOrderFilter({ status: AWAITING_DEPOSIT }).status).toBe(AWAITING_DEPOSIT);
  });

  it("무통장 + 접수됨 + 입금 미확인 만 고른다", () => {
    const w = orderWhere(parseOrderFilter({ status: AWAITING_DEPOSIT }));
    expect(w).toMatchObject({
      paymentMethod: "BANK_TRANSFER",
      status: "RECEIVED",
      depositConfirmedAt: null,
    });
  });

  it("입금 확인이 끝난 주문은 이 필터에 걸리지 않는다", () => {
    // depositConfirmedAt: null 조건이 빠지면 확인된 주문까지 '입금대기'로 보인다
    const w = orderWhere(parseOrderFilter({ status: AWAITING_DEPOSIT }));
    expect(w.depositConfirmedAt).toBeNull();
  });

  it("일반 상태 필터는 결제수단을 건드리지 않는다", () => {
    const w = orderWhere(parseOrderFilter({ status: "PREPARING" }));
    expect(w).toEqual({ status: "PREPARING" });
  });

  it("검색어·기간과 함께 쓸 수 있다", () => {
    const f = parseOrderFilter({ status: AWAITING_DEPOSIT, q: "러비" });
    const w = orderWhere(f);
    expect(w.status).toBe("RECEIVED");
    expect(w.OR).toBeDefined();
    expect(filterQuery(f)).toContain(`status=${AWAITING_DEPOSIT}`);
  });

  it("탭 이름을 붙여준다", () => {
    expect(orderFilterLabel(AWAITING_DEPOSIT)).toBe("입금대기");
    expect(orderFilterLabel("ALL")).toBe("전체");
    expect(orderFilterLabel("SHIPPED")).toBe("배송중");
    expect(orderFilterLabel("WEIRD")).toBe("WEIRD");
  });
});
