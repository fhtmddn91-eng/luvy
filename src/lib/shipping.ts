/**
 * 택배사 / 운송장(송장) 번호 처리.
 *
 * 순수 모듈이므로 서버 액션과 클라이언트 컴포넌트에서 모두 쓰고 테스트할 수 있다.
 */

export interface Courier {
  code: string;
  name: string;
  /**
   * 송장번호를 넣어 조회 페이지로 바로 이동하는 GET 링크.
   * 택배사가 URL 규격을 바꾸면 링크만 깨지고 번호 표시는 살아 있어야 하므로,
   * 링크가 없는 택배사(ETC)도 정상 상태로 취급한다.
   */
  trackUrl?: (no: string) => string;
}

export const COURIERS: readonly Courier[] = [
  {
    code: "CJ",
    name: "CJ대한통운",
    trackUrl: (no) => `https://trace.cjlogistics.com/next/tracking.html?wblNo=${no}`,
  },
  {
    code: "LOTTE",
    name: "롯데택배",
    trackUrl: (no) =>
      `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${no}`,
  },
  {
    code: "HANJIN",
    name: "한진택배",
    trackUrl: (no) =>
      `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${no}`,
  },
  {
    code: "POST",
    name: "우체국택배",
    trackUrl: (no) =>
      `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${no}`,
  },
  {
    code: "LOGEN",
    name: "로젠택배",
    trackUrl: (no) => `https://www.ilogen.com/web/personal/trace/${no}`,
  },
  {
    code: "KDEXP",
    name: "경동택배",
    trackUrl: (no) => `https://kdexp.com/basicNewDelivery.kd?barcode=${no}`,
  },
  { code: "ETC", name: "기타 / 직접배송" },
] as const;

const byCode = new Map(COURIERS.map((c) => [c.code, c]));

export const isCourierCode = (code: string): boolean => byCode.has(code);

export const courierName = (code: string): string => byCode.get(code)?.name ?? code;

/**
 * 운송장번호 정규화. 운영자가 붙여넣는 값에는 공백·하이픈이 섞여 들어오므로
 * 저장 전에 영숫자만 남긴다. (조회 링크에 그대로 넣을 수 있는 형태)
 */
export function normalizeTrackingNo(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

/** 국내 택배 운송장번호는 영숫자 8~20자리. (EMS 처럼 영문이 섞인 경우 포함) */
export function isValidTrackingNo(raw: string): boolean {
  return /^[0-9A-Z]{8,20}$/.test(normalizeTrackingNo(raw));
}

export interface ShipmentInfo {
  courier: string;
  trackingNo: string;
}

export const hasShipment = (s: ShipmentInfo): boolean =>
  s.courier !== "" && s.trackingNo !== "";

/**
 * 배송 조회 링크. 조회할 수 없는 조합(택배사 미지정·기타 택배사·잘못된 번호)이면
 * null 을 돌려주고, 화면은 번호만 노출한다.
 */
export function trackingUrl(s: ShipmentInfo): string | null {
  if (!hasShipment(s)) return null;
  const courier = byCode.get(s.courier);
  if (!courier?.trackUrl) return null;
  const no = normalizeTrackingNo(s.trackingNo);
  if (!isValidTrackingNo(no)) return null;
  return courier.trackUrl(encodeURIComponent(no));
}

/** 송장 입력 시 자동으로 '배송중'으로 올려야 하는 상태. */
const PRE_SHIP_STATUSES = ["PAID", "RECEIVED", "PREPARING"];

export const shouldAdvanceToShipped = (status: string): boolean =>
  PRE_SHIP_STATUSES.includes(status);
