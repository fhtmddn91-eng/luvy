/**
 * 카카오(옛 다음) 우편번호 서비스 로더 (브라우저 전용).
 *
 * 무료이고 **키가 필요 없다**. 카카오 지도 API 는 키 발급과 도메인 등록이
 * 필요한데 주소 검색만 쓰는 데는 그럴 이유가 없다.
 *
 * **CSP 를 함께 열어야 한다** (next.config.mjs):
 *   script-src  https://t1.kakaocdn.net        ← 이 스크립트 (공식 주소, 옛 t1.daumcdn.net 아님)
 *   frame-src   https://postcode.map.kakao.com  ← 검색 레이어가 띄우는 iframe
 *   form-action 같은 도메인                      ← 레이어가 iframe 안으로 form POST 한다
 * 빠뜨리면 「주소 찾기」를 눌러도 **아무 일도 일어나지 않는다** — 나이스페이 SDK 가
 * 같은 이유로 조용히 안 열렸다(2026-09-07 실측).
 */

/** 다음이 돌려주는 값 중 우리가 쓰는 것만 */
export interface PostcodeResult {
  /** 우편번호 5자리 */
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  /** 손님이 도로명(R)을 골랐는지 지번(J)을 골랐는지 */
  userSelectedType: "R" | "J";
  /** 법정동/법정리 — 도로명 주소의 참고항목 */
  bname?: string;
  /** 건물명 — 아파트면 참고항목에 넣는다 */
  buildingName?: string;
  apartment?: "Y" | "N";
}

interface PostcodeCtor {
  new (opts: {
    oncomplete: (data: PostcodeResult) => void;
    onclose?: (state: string) => void;
    width?: string;
    height?: string;
  }): { embed(el: HTMLElement, opts?: { autoClose?: boolean }): void; open(): void };
}

declare global {
  interface Window {
    daum?: { Postcode: PostcodeCtor };
  }
}

const SDK_SRC = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
let loading: Promise<void> | null = null;

export function loadPostcodeSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if (window.daum?.Postcode) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () =>
      window.daum?.Postcode
        ? resolve()
        : reject(new Error("주소 검색을 불러오지 못했습니다."));
    s.onerror = () => {
      // 다음에 다시 누르면 재시도할 수 있게 비운다 — 한 번 실패로 영영 막히면 안 된다
      loading = null;
      reject(new Error("주소 검색을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

// 검색 결과 → 기본주소 한 줄로 만드는 규칙은 순수 함수라 lib/address.ts 에 둔다
// (브라우저 전역 없이 테스트할 수 있게)
export { pickAddress } from "@/lib/address";
