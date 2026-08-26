/**
 * 패치 사각형 선택(chooseSafePatchRect) 상시 회귀 — 합성 픽스처라 모든 환경에서
 * 항상 실행된다 (live1·live3 재생은 진단 전용·이 머신 한정 → liveReplay.test.ts).
 * 실제 운영 함수 하나를 직접 부른다 — 알고리즘·산식을 테스트에 복제하지 않는다.
 *
 * 배율 회귀(2026-08-24 live3 보강): 같은 의미의 픽스처를 1×·1.5×·2× 로 그려
 * 판정이 배율에 흔들리지 않음을 못 박는다 — 분리 성분 허용이 절대 100px 였을 때
 * live3(글자 크게 그려짐)에서 ㅌ 윗획 104px 가 4px 차이로 탈락한 사고의 재발 방지.
 */
import { describe, it, expect } from "vitest";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  chooseSafePatchRect,
  detachedFragmentAllowed,
  gifPatchRect,
  toPixelBox,
  seamGap,
  seamLocalOk,
  SEAM_LOCAL_RUN_MID_MAX,
  type OcrBox,
} from "./imageTranslate";

// 정규화 [400,150,500,850] — s=1 기준 픽셀 y 160~200 (글자높이 40), x 60~340.
// gifPatchRect 패딩은 박스 크기에 비례(padY=높이×0.5)라 기하 전체가 배율에 비례한다:
// 기본 사각형 y 140~220, y2 후보 y 120~240.
const BOX: [number, number, number, number] = [400, 150, 500, 850];
const box = (over: Partial<OcrBox> = {}): OcrBox =>
  ({ box: BOX, zh: "强震深处", ko: "강렬한 진동", bg: "#ffffff", fg: "#000000", ...over }) as OcrBox;

type Ctx = ReturnType<Canvas["getContext"]>;
const raw = (c: Canvas, W: number, H: number): Uint8Array =>
  new Uint8Array(c.getContext("2d").getImageData(0, 0, W, H).data.buffer.slice(0));

/** 원본: 흰 바탕 + 박스 안 검은 글자 대역 (+ 링에 추가 그림) — 좌표는 전부 s 배 */
function origCanvas(s: number, draw?: (ctx: Ctx) => void): Canvas {
  const c = createCanvas(Math.round(400 * s), Math.round(400 * s));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(70 * s, 165 * s, 260 * s, 30 * s);
  draw?.(ctx);
  return c;
}

/** 재생성본: 박스 안을 다른 무늬로 + 원하는 추가 그리기 */
function regenCanvas(base: Canvas, s: number, draw?: (ctx: Ctx) => void): Canvas {
  const c = createCanvas(base.width, base.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(base, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(65 * s, 162 * s, 270 * s, 36 * s);
  ctx.fillStyle = "#111111";
  for (let x = 80; x < 320; x += 24) ctx.fillRect(x * s, 168 * s, 12 * s, 24 * s); // 바뀐 글자
  draw?.(ctx);
  return c;
}

/**
 * 글자 획 꼬리 — 기본 사각형(y220s) 아래 링까지 이어지는 빗살 + 잇는 밑획.
 * y235s 까지 내려 y1.5 후보(y230s)로는 못 담고 y2 후보(y240s)가 필요하게 한다 —
 * 링 검증 픽스처가 반드시 y2 링에서 평가되도록 하는 장치.
 * 획 폭 6s: 2× 에서도 12px 라 "꽉 찬 덩어리" 규칙(minDim>12)과 겹치지 않는
 * 실제 글자 굵기 범위다 (기존 안전 규칙은 그대로 두고 검증하기 위함).
 */
const glyphTail = (ctx: Ctx, s: number): void => {
  ctx.fillStyle = "#111111";
  for (let x = 80; x < 320; x += 12) ctx.fillRect(x * s, 198 * s, 6 * s, 36 * s);
  ctx.fillRect(80 * s, 231 * s, 240 * s, 4 * s);
};

const pick = (o: Canvas, r: Canvas, s: number, others: ReturnType<typeof toPixelBox>[] = []) => {
  const W = o.width;
  const H = o.height;
  return chooseSafePatchRect(raw(o, W, H), raw(r, W, H), W, H, box(), others);
};

describe.each([1, 1.5, 2])("chooseSafePatchRect — 배율 %s× (동일 의미 = 동일 판정)", (s) => {
  it("경계 침범이 없으면 기본 사각형을 그대로 채택한다", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s);
    const p = pick(o, r, s);
    expect(p).not.toBeNull();
    expect(p!.scaled).toBe(false);
  });

  it("글자 획만 기본 사각형 밖으로 뻗은 경우: 확장 후보 통과 (임계값 완화 없음)", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s, (ctx) => glyphTail(ctx, s));
    const p = pick(o, r, s);
    expect(p).not.toBeNull();
    expect(p!.scaled).toBe(true);
    expect(p!.rect.y1).toBeGreaterThan(220 * s); // 세로 확장으로 꼬리를 통째로 담았다
  });

  it("확장 링의 분리 획 조각(면적 100 초과, 길쭉, 잉크 생김): live3 재발 방지 — 통과", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s, (ctx) => {
      glyphTail(ctx, s);
      // ㅌ 윗획처럼 **떨어져 나온** 가로획 — s=1 에서 30×5=150px (구 절대 기준 100 초과).
      // 꼬리(x80s~)·기본 사각형(y225s)과 둘 다 안 닿아야 분리 성분으로 평가된다
      ctx.fillStyle = "#111111";
      ctx.fillRect(20 * s, 229 * s, 30 * s, 5 * s);
    });
    const p = pick(o, r, s);
    expect(p).not.toBeNull();
    expect(p!.scaled).toBe(true);
  });

  it("같은 자리의 꽉 찬 정사각 조각(배지 모양): 거부(null)", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s, (ctx) => {
      glyphTail(ctx, s);
      // 기본 사각형(y225s)·꼬리(x80s~)와 둘 다 떨어진 독립 덩어리 — 길쭉하지 않다.
      // 경계에 걸치게 그리면 글자에서 이어진 성분으로 합쳐져 검사 대상이 안 된다
      ctx.fillStyle = "#111111";
      ctx.fillRect(20 * s, 229 * s, 12 * s, 12 * s);
    });
    expect(pick(o, r, s)).toBeNull();
  });

  it("live3 조각과 같은 면적(104px)이라도 꽉 찬 도형이면 거부 — 면적이 아니라 모양으로 가른다", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s, (ctx) => {
      glyphTail(ctx, s);
      ctx.fillStyle = "#111111";
      ctx.fillRect(20 * s, 229 * s, 10 * s, 10 * s); // 100px 정사각 (live3 104px 와 같은 급)
    });
    expect(pick(o, r, s)).toBeNull();
  });

  it("획 하나로 설명 안 되는 큰 독립 띠: 길쭉하고 잉크가 생겨도 거부", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s, (ctx) => {
      glyphTail(ctx, s);
      // 길쭉함 12.7 · 잉크 생김이지만 면적 456s² — s=1 은 상대 한도(0.18h²=361),
      // s≥1.5 는 절대 상한(700)이 먼저 걸린다. 어느 쪽이든 거부다
      ctx.fillStyle = "#111111";
      ctx.fillRect(2 * s, 229 * s, 76 * s, 6 * s);
    });
    expect(pick(o, r, s)).toBeNull();
  });

  it("확장 링 안에서 제품 윤곽이 잘려 얇아진 경우: 기하가 획과 똑같아도 거부 (잉크 방향)", () => {
    // 후보 사각형에 잘리면 40×8(면적 320 = 0.16h², 길쭉함 5.0)이라 live3 획 조각
    // (0.103h², 2.57)과 상대 지표가 겹친다 — 잉크가 사라진 방향으로만 가려진다
    const o = origCanvas(s, (ctx) => {
      ctx.fillStyle = "#333333";
      ctx.fillRect(15 * s, 228 * s, 40 * s, 14 * s);
    });
    const r = regenCanvas(o, s, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(15 * s, 228 * s, 40 * s, 14 * s); // 도형이 배경으로 뭉개짐
      glyphTail(ctx, s);
    });
    expect(pick(o, r, s)).toBeNull();
  });

  it("확장 링 안에서 제품 도형이 사라진 경우: 거부(null)", () => {
    const o = origCanvas(s, (ctx) => {
      ctx.fillStyle = "#333333";
      ctx.fillRect(15 * s, 228 * s, 40 * s, 14 * s); // 링 한복판 도형 — 꼬리(x80~)와 안 겹침
    });
    const r = regenCanvas(o, s, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(15 * s, 228 * s, 40 * s, 14 * s); // 도형 제거 (독립 변화)
      glyphTail(ctx, s); // 확장이 필요하지만 링 훼손 때문에 거부돼야 한다
    });
    expect(pick(o, r, s)).toBeNull();
  });

  it("확장 링 안에서 배경 무늬·색이 다시 그려진 경우: 거부(null)", () => {
    const o = origCanvas(s);
    const r = regenCanvas(o, s, (ctx) => {
      // 배경 재렌더를 **먼저** 깔고 그 위에 꼬리를 그린다 — 순서를 뒤집으면 회색이
      // 꼬리를 덮어 확장이 필요 없어지고, 기본 사각형이 채택돼 검사가 무력해진다
      ctx.fillStyle = "#e8e8e8"; // 아래쪽 링 전체를 미묘하게 다른 색으로 (Δ23)
      ctx.fillRect(0, 225 * s, 400 * s, 22 * s);
      glyphTail(ctx, s);
    });
    expect(pick(o, r, s)).toBeNull();
  });
});

describe("chooseSafePatchRect — 이웃·전패 (1×)", () => {
  it("이웃 OCR 박스를 침범해야만 담기는 꼬리: 후보가 잘려 거부(null)", () => {
    const o = origCanvas(1);
    const r = regenCanvas(o, 1, (ctx) => glyphTail(ctx, 1));
    // 이웃 박스가 기본 사각형 바로 아래를 차지 — 확장 후보가 침범 직전에서 잘린다
    const neighbor = toPixelBox([570, 150, 660, 850], 400, 400); // y ≈ 226~266
    expect(pick(o, r, 1, [neighbor])).toBeNull();
  });

  it("모든 후보 실패(꼬리가 최대 후보보다도 길다): null — 원문 유지 + PATCH_REJECTED 경로", () => {
    const o = origCanvas(1);
    const r = regenCanvas(o, 1, (ctx) => {
      ctx.fillStyle = "#111111";
      for (let x = 80; x < 320; x += 12) ctx.fillRect(x, 198, 8, 90); // y 288 — y2 후보(240) 밖
    });
    expect(pick(o, r, 1)).toBeNull();
  });
});

describe("detachedFragmentAllowed — 분리 성분 산식 (운영과 같은 함수)", () => {
  /** 글자가 새로 그려진 경우: 원본은 배경, 출력은 진한 잉크 (실측 orig≈0 regen≈238) */
  const ADDED = { origFromBg: 0, regenFromBg: 238 };
  /** 있던 것이 사라진 경우: 원본은 진한 도형, 출력은 배경 (실측 orig≈204 regen≈0) */
  const REMOVED = { origFromBg: 204, regenFromBg: 0 };

  it("운영 실측 두 사례 모두 통과 — live1 조각 53px(16×4), live3 ㅌ 윗획 104px(18×7)", () => {
    expect(detachedFragmentAllowed(53, 16, 4, 30.3, ADDED)).toBe(true);
    expect(detachedFragmentAllowed(104, 18, 7, 31.7, ADDED)).toBe(true);
  });
  it("면적이 아니라 모양으로 가른다 — 같은 104px 라도 꽉 찬 정사각은 거부", () => {
    expect(detachedFragmentAllowed(104, 10, 10, 31.7, ADDED)).toBe(false);
    expect(detachedFragmentAllowed(110, 11, 10, 31.7, ADDED)).toBe(false);
    // 실측 배지(144px, 12×12, 글줄 44.8)는 면적 비율 0.072 로 live3 획(0.103)보다
    // 작다 — 비율 기준만 뒀다면 통과했을 사례다
    expect(detachedFragmentAllowed(144, 12, 12, 44.8, ADDED)).toBe(false);
  });
  it("기하가 획과 똑같아도 잉크가 사라진 변화는 거부 — 잘린 제품 윤곽(40×8, 0.16h²)", () => {
    // live3 획과 상대 지표가 겹치는 기하: 면적 320/0.16h², 길쭉함 5.0
    expect(detachedFragmentAllowed(320, 40, 8, 44.8, ADDED)).toBe(true); // 잉크 생김 = 글자
    expect(detachedFragmentAllowed(320, 40, 8, 44.8, REMOVED)).toBe(false); // 사라짐 = 윤곽 훼손
    // 잡음 구간(±8)에서는 통과로 넘기지 않는다
    expect(detachedFragmentAllowed(320, 40, 8, 44.8, { origFromBg: 100, regenFromBg: 105 })).toBe(false);
  });
  it("같은 획 조각은 1×·1.5×·2× 에서 같은 판정 (비율·길쭉함·잉크 방향 불변)", () => {
    for (const s of [1, 1.5, 2]) {
      expect(detachedFragmentAllowed(104 * s * s, 18 * s, 7 * s, 31.7 * s, ADDED)).toBe(true);
      expect(detachedFragmentAllowed(53 * s * s, 16 * s, 4 * s, 30.3 * s, ADDED)).toBe(true);
      // 획 하나로 설명 안 되는 비율(0.38 h²)은 어느 배율에서도 거부
      expect(detachedFragmentAllowed(600 * s * s, 60 * s, 10 * s, 40 * s, ADDED)).toBe(false);
      // 꽉 찬 덩어리·사라진 변화도 어느 배율에서도 거부
      expect(detachedFragmentAllowed(144 * s * s, 12 * s, 12 * s, 44.8 * s, ADDED)).toBe(false);
      expect(detachedFragmentAllowed(320 * s * s, 40 * s, 8 * s, 44.8 * s, REMOVED)).toBe(false);
    }
  });
  it("절대 상한(700px): 글줄이 아무리 두꺼워도 그 이상의 독립 변화는 거부", () => {
    expect(detachedFragmentAllowed(700, 150, 5, 500, ADDED)).toBe(false);
    expect(detachedFragmentAllowed(699, 150, 5, 500, ADDED)).toBe(true); // 상한 미만·길쭉은 허용
  });
  it("모양 무관 하한도 글자 크기 비례 — 절대 99px 구멍이 막혔다", () => {
    // 작은 글줄(31.7)에서 99px 정사각 덩어리: 옛 절대 하한 100 이면 통과했다
    expect(detachedFragmentAllowed(99, 10, 10, 31.7, ADDED)).toBe(false);
    // 큰 제목 글줄(80)에서 같은 99px 은 점 수준(0.015 h²) — 모양·방향 무관 통과
    expect(detachedFragmentAllowed(99, 10, 10, 80, REMOVED)).toBe(true);
  });
});

describe("seamLocalOk — 국소 이음매 판정 (운영과 같은 함수, 합성 픽스처)", () => {
  // 400×400, 패치 rect [60,140,340,220]. 배경을 가르는 대각 경계가 rect 를 지난다.
  const R: { x0: number; y0: number; x1: number; y1: number } = { x0: 60, y0: 140, x1: 340, y1: 220 };
  const SW = 400;
  const SH = 400;
  const paint = (draw: (ctx: Ctx) => void): Uint8Array => {
    const c = createCanvas(SW, SH);
    const ctx = c.getContext("2d");
    draw(ctx);
    return new Uint8Array(ctx.getImageData(0, 0, SW, SH).data.buffer.slice(0));
  };
  /** 배경 + 대각 경계(연보라 | 베이지, Δ≈81) — shift 만큼 옆으로 밀린 버전 */
  const scene = (ctx: Ctx, shift: number) => {
    ctx.fillStyle = "#b491cf";
    ctx.fillRect(0, 0, SW, SH);
    ctx.fillStyle = "#e9e2d2";
    ctx.beginPath();
    ctx.moveTo(200 + shift, 0);
    ctx.lineTo(SW, 0);
    ctx.lineTo(SW, SH);
    ctx.lineTo(300 + shift, SH);
    ctx.closePath();
    ctx.fill();
  };
  /** rect 안쪽만 다시 그린다 — 경계 안팎이 달라지는 유일한 통로 */
  const insideOnly = (base: (ctx: Ctx) => void, inner: (ctx: Ctx) => void): Uint8Array =>
    paint((ctx) => {
      base(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
      ctx.clip();
      inner(ctx);
      ctx.restore();
    });
  const orig = paint((c) => scene(c, 0));

  it("깨끗한 경계(안쪽 글자만 변화): 통과", () => {
    const regen = insideOnly((c) => scene(c, 0), (c) => {
      c.fillStyle = "#333";
      c.fillRect(80, 160, 100, 40); // 경계에서 떨어진 안쪽 변화만
    });
    expect(seamLocalOk(orig, regen, SW, SH, R).ok).toBe(true);
  });

  it("1px 스파이크: max 는 크지만 거부하지 않는다 (진단 전용)", () => {
    const regen = insideOnly((c) => scene(c, 0), (c) => {
      c.fillStyle = "#000";
      c.fillRect(150, R.y0, 1, 1); // 경계 위 1px
    });
    const s = seamLocalOk(orig, regen, SW, SH, R);
    expect(s.max).toBeGreaterThan(100);
    expect(s.ok).toBe(true);
  });

  it("짧은 노이즈(2~3px 점 몇 개): 통과", () => {
    const regen = insideOnly((c) => scene(c, 0), (c) => {
      c.fillStyle = "#222";
      c.fillRect(100, R.y0, 3, 1);
      c.fillRect(200, R.y1 - 1, 2, 1);
      c.fillRect(R.x0, 180, 1, 2);
    });
    expect(seamLocalOk(orig, regen, SW, SH, R).ok).toBe(true);
  });

  it("연속 대각선 단절(안쪽 16px 밀림): 거부 — live3 A 패치 사고 재현", () => {
    const regen = insideOnly((c) => scene(c, 0), (c) => scene(c, 16));
    const s = seamLocalOk(orig, regen, SW, SH, R);
    expect(s.ok).toBe(false);
    expect(s.runHigh).toBeGreaterThan(8); // "끊긴 선"은 이어진다
  });

  it("은은한 색 띠(Δ≈33, p99·run48 을 다 피함): run32 로 거부", () => {
    const regen = insideOnly((c) => scene(c, 0), (c) => {
      c.fillStyle = "#a983c6"; // 원 배경 #b491cf 에서 Δ≈33
      c.fillRect(0, 0, SW, SH);
    });
    const s = seamLocalOk(orig, regen, SW, SH, R);
    expect(s.ok).toBe(false);
    expect(s.runMid).toBeGreaterThan(SEAM_LOCAL_RUN_MID_MAX);
  });

  it("그라데이션 미세 오프셋(자연스러운 재현): 통과", () => {
    const grad = (ctx: Ctx, off: number) => {
      const g = ctx.createLinearGradient(off, 0, SW + off, 0);
      g.addColorStop(0, "#e8dff0");
      g.addColorStop(1, "#cdbfdc");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SW, SH);
    };
    const go = paint((c) => grad(c, 0));
    const gr = insideOnly((c) => grad(c, 0), (c) => grad(c, -6));
    expect(seamLocalOk(go, gr, SW, SH, R).ok).toBe(true);
  });

  it("원본에 원래 있던 경계 점프는 벌점이 없다 — 대각선을 그대로 두면 통과", () => {
    // 안쪽을 원본과 똑같이 다시 그린 경우 (모델이 완벽 재현) — 증가분 0
    const regen = insideOnly((c) => scene(c, 0), (c) => scene(c, 0));
    const s = seamLocalOk(orig, regen, SW, SH, R);
    expect(s.p99).toBe(0);
    expect(s.ok).toBe(true);
  });
});

describe("seamGap — 정수·소수 rect 모두 유한값과 같은 판정 (영구 방어)", () => {
  it("소수 좌표 rect 에서도 NaN 없이 정수 rect 와 같은 값을 낸다", () => {
    const o = origCanvas(1);
    const r = regenCanvas(o, 1);
    const or = raw(o, 400, 400);
    const rr = raw(r, 400, 400);
    const intRect = { x0: 60, y0: 140, x1: 340, y1: 220 };
    const fracRect = { x0: 60.4, y0: 139.6, x1: 339.7, y1: 220.2 };
    const a = seamGap(or, rr, 400, 400, intRect);
    const b = seamGap(or, rr, 400, 400, fracRect);
    expect(Number.isFinite(a)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
    expect(b).toBeCloseTo(a, 5);
  });
  it("운영 사각형(gifPatchRect)은 항상 정수 좌표다 — 전제 검증", () => {
    const g = gifPatchRect(box(), 400, 400);
    for (const v of [g.x0, g.y0, g.x1, g.y1]) expect(Number.isInteger(v)).toBe(true);
  });
});
