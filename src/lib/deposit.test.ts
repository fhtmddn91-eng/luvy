import { describe, it, expect } from "vitest";
import {
  parseDepositInput,
  depositGap,
  depositGapLabel,
  elapsedLabel,
  isStaleDeposit,
  DEPOSITOR_MAX,
} from "./deposit";

const at = (s: string) => new Date(s);

describe("parseDepositInput", () => {
  it("입금자명과 금액을 받는다", () => {
    const r = parseDepositInput({ depositorName: " 러비상사 ", depositAmount: "132000" });
    expect(r).toEqual({ ok: true, value: { depositorName: "러비상사", depositAmount: 132000 } });
  });

  it("통장에서 복사한 콤마·원 표기를 그대로 받아준다", () => {
    // 운영자는 통장 앱에서 "1,234,000 원" 을 복사해 붙인다
    const r = parseDepositInput({ depositorName: "채재민", depositAmount: "1,234,000 원" });
    expect(r).toEqual({ ok: true, value: { depositorName: "채재민", depositAmount: 1234000 } });
  });

  it("입금자명이 비면 거부한다 — 이름 없는 입금은 대사할 수 없다", () => {
    const r = parseDepositInput({ depositorName: "   ", depositAmount: "1000" });
    expect(r).toEqual({ ok: false, error: "통장에 찍힌 입금자명을 입력해주세요." });
  });

  it("긴 법인명은 잘라서 저장한다", () => {
    const long = "가".repeat(80);
    const r = parseDepositInput({ depositorName: long, depositAmount: "1000" });
    expect(r.ok && r.value.depositorName.length).toBe(DEPOSITOR_MAX);
  });

  it("숫자가 아니거나 0 이하인 금액은 거부한다", () => {
    expect(parseDepositInput({ depositorName: "가", depositAmount: "" }).ok).toBe(false);
    expect(parseDepositInput({ depositorName: "가", depositAmount: "abc" }).ok).toBe(false);
    expect(parseDepositInput({ depositorName: "가", depositAmount: "0" }).ok).toBe(false);
    expect(parseDepositInput({ depositorName: "가", depositAmount: "-500" }).ok).toBe(false);
    expect(parseDepositInput({ depositorName: "가", depositAmount: "12.5" }).ok).toBe(false);
  });
});

describe("depositGap — 부족·초과는 막지 않고 기록한다", () => {
  it("정확히 맞으면 exact", () => {
    expect(depositGap(50000, 50000)).toEqual({ kind: "exact" });
    expect(depositGapLabel(50000, 50000)).toBe("");
  });

  it("부족분·초과분을 계산한다", () => {
    expect(depositGap(47000, 50000)).toEqual({ kind: "short", diff: 3000 });
    expect(depositGap(53000, 50000)).toEqual({ kind: "over", diff: 3000 });
    expect(depositGapLabel(47000, 50000)).toBe("3,000원 부족");
    expect(depositGapLabel(53000, 50000)).toBe("3,000원 초과");
  });
});

describe("elapsedLabel", () => {
  const base = at("2026-08-27T12:00:00+09:00");

  it("분·시간·일 단위로 줄여 쓴다", () => {
    expect(elapsedLabel(base, at("2026-08-27T12:00:30+09:00"))).toBe("방금");
    expect(elapsedLabel(base, at("2026-08-27T12:40:00+09:00"))).toBe("40분");
    expect(elapsedLabel(base, at("2026-08-27T17:00:00+09:00"))).toBe("5시간");
    expect(elapsedLabel(base, at("2026-08-29T12:00:00+09:00"))).toBe("2일");
    expect(elapsedLabel(base, at("2026-08-30T16:00:00+09:00"))).toBe("3일 4시간");
  });

  it("시계가 어긋나 미래로 찍혀도 깨지지 않는다", () => {
    expect(elapsedLabel(base, at("2026-08-27T11:00:00+09:00"))).toBe("방금");
  });
});

describe("isStaleDeposit — 48시간", () => {
  const base = at("2026-08-27T12:00:00+09:00");

  it("48시간이 지나면 오래된 미입금으로 본다", () => {
    expect(isStaleDeposit(base, at("2026-08-29T11:59:00+09:00"))).toBe(false);
    expect(isStaleDeposit(base, at("2026-08-29T12:00:00+09:00"))).toBe(true);
  });
});
