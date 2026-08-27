/**
 * 무통장입금 확인에 쓰는 순수 함수들.
 *
 * 무통장은 "주문 접수"와 "돈이 들어옴"이 다른 사건인데, 예전엔 둘 다 `RECEIVED`
 * 하나로 뭉뚱그려져 있었다. 그래서 미입금 주문과 입금된 주문을 화면에서 구분할
 * 방법이 없었고, 통장 대사는 전부 시스템 밖(엑셀·통장 앱)에서 이뤄져 누가 언제
 * 무엇을 보고 발송을 시작했는지 기록이 남지 않았다.
 *
 * 입금자명을 따로 받는 이유: 사업자 주문은 **주문자와 입금자명이 다른 경우가
 * 흔하다**(법인 통장·대표 개인 통장·직원 명의). 이름이 안 맞아 못 찾는 입금이
 * 실제 대사 실패의 대부분이라, 통장에 찍힌 이름 그대로를 남긴다.
 */

/** 통장 표기가 길어야 이 정도다 (법인명 + 지점) */
export const DEPOSITOR_MAX = 40;

export interface DepositInput {
  depositorName: string;
  depositAmount: number;
}

export type DepositParseResult = { ok: true; value: DepositInput } | { ok: false; error: string };

/**
 * 입금 확인 폼 값 검사.
 * 금액은 원 단위 정수만 받는다 — 콤마·원 표기는 지워서 받아준다(운영자가 통장에서
 * 복사해 붙이는 값이라 "1,234,000 원" 형태로 들어오는 게 정상이다).
 */
export function parseDepositInput(raw: { depositorName: string; depositAmount: string }): DepositParseResult {
  const depositorName = raw.depositorName.trim().slice(0, DEPOSITOR_MAX);
  if (!depositorName) return { ok: false, error: "통장에 찍힌 입금자명을 입력해주세요." };

  const digits = raw.depositAmount.replace(/[,\s원]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: "입금액은 숫자로 입력해주세요." };

  const depositAmount = Number(digits);
  if (depositAmount <= 0) return { ok: false, error: "입금액은 0보다 커야 합니다." };
  if (!Number.isSafeInteger(depositAmount)) return { ok: false, error: "입금액이 올바르지 않습니다." };

  return { ok: true, value: { depositorName, depositAmount } };
}

export type DepositGap = { kind: "exact" } | { kind: "short" | "over"; diff: number };

/**
 * 입금액과 주문 총액의 차이.
 *
 * 부족·초과를 **막지 않고 기록만 한다** — 배송비를 빼고 넣거나 여러 주문을 한 번에
 * 보내는 일이 실제로 잦아서, 여기서 차단하면 운영자가 시스템을 우회하게 된다.
 * 대신 감사로그에 남겨 나중에 대사할 수 있게 한다.
 */
export function depositGap(depositAmount: number, total: number): DepositGap {
  if (depositAmount === total) return { kind: "exact" };
  return depositAmount < total
    ? { kind: "short", diff: total - depositAmount }
    : { kind: "over", diff: depositAmount - total };
}

/** 감사로그·화면에 붙일 한 줄. 금액이 맞으면 빈 문자열 */
export function depositGapLabel(depositAmount: number, total: number): string {
  const gap = depositGap(depositAmount, total);
  if (gap.kind === "exact") return "";
  const won = gap.diff.toLocaleString("ko-KR");
  return gap.kind === "short" ? `${won}원 부족` : `${won}원 초과`;
}

/**
 * 미입금 경과 시간 표시. 어드민 목록에서 "얼마나 방치됐는지"를 한눈에 본다.
 * 주문은 즉시 재고를 물고 있으므로, 오래된 미입금은 실제로 재고를 잠그는 비용이다.
 */
export function elapsedLabel(from: Date, now: Date): string {
  const ms = now.getTime() - from.getTime();
  if (ms < 0) return "방금";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days}일 ${restHours}시간` : `${days}일`;
}

/**
 * 미입금이 오래된 주문인지 (목록에서 눈에 띄게 표시할 기준).
 * 영업일 기준 이틀이면 사실상 안 들어올 돈이라 재고를 풀지 판단해야 한다.
 */
export const STALE_DEPOSIT_HOURS = 48;

export function isStaleDeposit(from: Date, now: Date): boolean {
  return now.getTime() - from.getTime() >= STALE_DEPOSIT_HOURS * 3600_000;
}
