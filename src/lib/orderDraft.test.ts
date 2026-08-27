/**
 * 주문서 작성 — 품목 조용한 제외 방지 회귀 테스트.
 *
 * 실사례(2026-08-27 소프트오픈 점검): buildOrderDraft 가 비활성·가격 미설정
 * 품목을 **말없이 걸러내고** 나머지만 주문했다. 손님은 장바구니 전부가 주문된
 * 줄 알고 결제까지 마치는데 주문서에는 일부만 남는다. 이제 하나라도 걸리면
 * 주문 전체를 멈추고 품목·사유를 알려준다 — 이 동작이 되돌아가면 여기서 깨진다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { orderBlockReason, optionBlockReason, partitionCart, blockedCartMessage } from "./orderDraft";

// ---------- 순수 함수 ----------

const active = (name: string) => ({
  name,
  status: "ACTIVE",
  priceTiers: [{ minQty: 1, unitPrice: 1000 }],
  options: [] as { id: string; active: boolean }[],
});

describe("orderBlockReason", () => {
  it("판매중 + 티어 있음 → 주문 가능", () => {
    expect(orderBlockReason(active("A"))).toBeNull();
  });

  it("비활성 상품은 사유를 돌려준다", () => {
    expect(orderBlockReason({ status: "HIDDEN", priceTiers: [{}] })).toContain("판매");
    expect(orderBlockReason({ status: "SOLD_OUT", priceTiers: [{}] })).toContain("판매");
  });

  it("가격 티어가 없으면 사유를 돌려준다 (0원 주문 방지)", () => {
    expect(orderBlockReason({ status: "ACTIVE", priceTiers: [] })).toContain("가격");
  });
});

describe("partitionCart / blockedCartMessage", () => {
  it("불가 품목은 이름·사유와 함께 blocked 로 모인다", () => {
    const cart = [
      { product: active("정상품") },
      { product: { name: "숨김상품", status: "HIDDEN", priceTiers: [{}], options: [] } },
      { product: { name: "가격없음", status: "ACTIVE", priceTiers: [], options: [] } },
    ];
    const { orderable, blocked } = partitionCart(cart);
    expect(orderable).toHaveLength(1);
    expect(blocked).toHaveLength(2);

    const msg = blockedCartMessage(blocked);
    expect(msg).toContain("숨김상품");
    expect(msg).toContain("가격없음");
    expect(msg).toContain("주문을 진행하지 않았습니다");
  });

  it("전부 주문 가능하면 blocked 가 비어 있다", () => {
    const { orderable, blocked } = partitionCart([{ product: active("A") }, { product: active("B") }]);
    expect(orderable).toHaveLength(2);
    expect(blocked).toHaveLength(0);
  });
});

// ---------- 실제 buildOrderDraft 경로 ----------

interface CartRow {
  productId: string;
  quantity: number;
  optionId: string | null;
  product: {
    name: string;
    brand: string;
    sku: string | null;
    status: string;
    priceTiers: { minQty: number; unitPrice: number }[];
    options: { id: string; name: string; unitPrice: number; trackStock: boolean; stock: number; active: boolean }[];
  };
}

const state = { cart: [] as CartRow[] };

vi.mock("@/lib/db", () => ({
  db: { cartItem: { findMany: async () => state.cart } },
}));
vi.mock("@/lib/portone", () => ({ fetchPortOnePayment: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getShippingPolicy: async () => ({ fee: 3000, freeThreshold: 50000 }),
}));

const { buildOrderDraft } = await import("./payments");

const row = (
  over: Omit<Partial<CartRow>, "product"> & { product?: Partial<CartRow["product"]> },
): CartRow => ({
  productId: "p1",
  quantity: 2,
  optionId: null,
  ...over,
  product: {
    name: "진동기",
    brand: "LUVY",
    sku: "SKU-1",
    status: "ACTIVE",
    priceTiers: [{ minQty: 1, unitPrice: 1000 }],
    options: [],
    ...over.product,
  },
});

beforeEach(() => {
  state.cart = [];
});

describe("buildOrderDraft — 일부 품목 누락 시 전체 중단", () => {
  it("빈 장바구니는 안내 문구와 함께 실패한다", async () => {
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("장바구니가 비어");
  });

  it("비활성 품목이 섞여 있으면 정상 품목이 있어도 주문을 만들지 않는다", async () => {
    state.cart = [
      row({ productId: "p1" }),
      row({ productId: "p2", product: { name: "숨김상품", status: "HIDDEN" } }),
    ];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("숨김상품");
      expect(res.error).toContain("판매");
    }
  });

  it("가격 미설정 품목이 섞여 있으면 주문을 만들지 않는다", async () => {
    state.cart = [
      row({ productId: "p1" }),
      row({ productId: "p2", product: { name: "가격없음", priceTiers: [] } }),
    ];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("가격없음");
  });

  it("전부 주문 가능하면 품목 수·금액이 장바구니와 일치한다", async () => {
    state.cart = [
      row({ productId: "p1", quantity: 2 }),
      row({ productId: "p2", quantity: 3, product: { name: "젤", sku: null } }),
    ];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.items).toHaveLength(2); // 하나도 빠지지 않는다
      expect(res.draft.subtotal).toBe(2 * 1000 + 3 * 1000);
      expect(res.draft.total).toBe(res.draft.subtotal + 3000);
    }
  });

  it("옵션 주문은 optionId 가 주문서 품목에 남는다 (취소 시 재고 복원 위치)", async () => {
    state.cart = [
      row({
        productId: "p1",
        optionId: "o1",
        product: {
          options: [{ id: "o1", name: "핑크", unitPrice: 1500, trackStock: true, stock: 10, active: true }],
        },
      }),
    ];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.items[0].optionId).toBe("o1");
      expect(res.draft.items[0].optionName).toBe("핑크");
      expect(res.draft.items[0].unitPrice).toBe(1500);
    }
  });
});

/**
 * 죽은 옵션 방어 (소프트오픈 전 필수).
 *
 * 장바구니는 optionId 를 그대로 들고 있는데, 그 사이 운영자가 옵션을 지우거나
 * 판매 중지할 수 있다. 예전 buildOrderDraft 는 `options.find(...)` 가 undefined 면
 * **조용히 기본 상품·기본 가격으로 주문**했다 — 손님은 "핑크 3만원"을 담았는데
 * 주문서에는 옵션 없이 기본가로 찍히고, 취소 시 되돌릴 옵션 재고도 사라진다.
 * 다른 상품의 optionId 를 밀어 넣어도 같은 길로 통과했다.
 */
describe("optionBlockReason — 죽은 옵션은 기본가로 대체하지 않는다", () => {
  const opts = [
    { id: "o1", name: "핑크", active: true },
    { id: "o2", name: "블랙", active: false },
  ];

  it("옵션을 안 고른 상품은 통과한다", () => {
    expect(optionBlockReason(null, opts)).toBeNull();
    expect(optionBlockReason("", opts)).toBeNull();
  });

  it("살아 있는 옵션은 통과한다", () => {
    expect(optionBlockReason("o1", opts)).toBeNull();
  });

  it("삭제된 옵션은 사유를 돌려준다 (기본가 대체 금지)", () => {
    expect(optionBlockReason("gone", opts)).toContain("옵션");
  });

  it("다른 상품 소속 옵션도 같은 사유로 막는다", () => {
    // 이 상품의 options 에 없다는 점에서 삭제와 구분이 안 되고, 구분할 필요도 없다
    expect(optionBlockReason("other-product-option", opts)).toContain("옵션");
  });

  it("판매 중지된 옵션은 찾아지더라도 막는다", () => {
    expect(optionBlockReason("o2", opts)).toContain("중지");
  });

  it("옵션이 하나도 없는 상품에 optionId 가 남아 있으면 막는다", () => {
    expect(optionBlockReason("o1", [])).not.toBeNull();
  });
});

describe("partitionCart — 죽은 옵션이 섞이면 주문 전체를 멈춘다", () => {
  const product = (over: Partial<{ name: string; status: string; priceTiers: unknown[]; options: { id: string; name: string; active: boolean }[] }> = {}) => ({
    name: "진동기",
    status: "ACTIVE",
    priceTiers: [{ minQty: 1, unitPrice: 1000 }],
    options: [{ id: "o1", name: "핑크", active: true }],
    ...over,
  });

  it("삭제된 옵션 품목은 blocked 로 간다", () => {
    const { orderable, blocked } = partitionCart([{ optionId: "gone", product: product() }]);
    expect(orderable).toHaveLength(0);
    expect(blocked[0].name).toBe("진동기");
    expect(blocked[0].reason).toContain("옵션");
  });

  it("정상 품목과 섞이면 정상 품목도 주문되지 않는다", () => {
    const { blocked } = partitionCart([
      { optionId: "o1", product: product() },
      { optionId: "dead", product: product({ name: "젤" }) },
    ]);
    expect(blocked).toHaveLength(1);
    expect(blockedCartMessage(blocked)).toContain("젤");
  });

  it("상품 자체가 막힌 경우 옵션 사유로 덮어쓰지 않는다", () => {
    const { blocked } = partitionCart([{ optionId: "gone", product: product({ status: "HIDDEN" }) }]);
    expect(blocked[0].reason).toContain("판매가 중지된 상품");
  });
});

describe("buildOrderDraft — 죽은 옵션은 주문 전체를 중단시킨다 (실제 경로)", () => {
  const withOpts = (opts: CartRow["product"]["options"]) => ({ options: opts });
  const LIVE = { id: "o1", name: "핑크", unitPrice: 1500, trackStock: true, stock: 10, active: true };
  const DEAD = { id: "o2", name: "블랙", unitPrice: 1500, trackStock: true, stock: 10, active: false };

  it("삭제된 옵션이면 기본가로 대체하지 않고 실패한다", async () => {
    state.cart = [row({ optionId: "gone", product: withOpts([LIVE]) })];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("옵션");
  });

  it("다른 상품 소속 optionId 를 밀어 넣어도 실패한다", async () => {
    // 폼 조작으로 남의 상품 옵션 id 를 보내는 경우 — 이 상품 options 에 없다
    state.cart = [row({ optionId: "other-product-opt", product: withOpts([LIVE]) })];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
  });

  it("판매 중지된 옵션이면 실패한다", async () => {
    state.cart = [row({ optionId: "o2", product: withOpts([LIVE, DEAD]) })];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("중지");
  });

  it("죽은 옵션이 하나라도 있으면 멀쩡한 품목도 주문되지 않는다", async () => {
    state.cart = [
      row({ productId: "p1", optionId: "o1", product: withOpts([LIVE]) }),
      row({ productId: "p2", optionId: "gone", product: { name: "젤", ...withOpts([LIVE]) } }),
    ];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("젤");
  });

  it("살아 있는 옵션은 그대로 통과하고 옵션가가 적용된다", async () => {
    state.cart = [row({ optionId: "o1", quantity: 2, product: withOpts([LIVE, DEAD]) })];
    const res = await buildOrderDraft("u1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.items[0].optionId).toBe("o1");
      expect(res.draft.items[0].unitPrice).toBe(1500);
    }
  });
});
