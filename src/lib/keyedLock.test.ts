/**
 * 같은 대상에 같은 작업이 겹쳐 도는 것을 막는 선점 잠금.
 *
 * 실사례(2026-08-27 감사): 이미지 번역은 `void translateProductImages(...)` 로
 * 백그라운드에서 돌고 장당 십수 초 × 수십 장이 걸린다. 그 사이 운영자가 "판매"
 * 토글이나 상품 저장을 한 번 더 누르면 두 번째 실행이 겹치는데, 자산별 건너뛰기
 * 목록이 TRANSLATING 을 "중단된 흔적"으로 보고 다시 돌리기 때문에 1차가 작업
 * 중인 자산을 2차가 또 집었다 — 캐시는 1차가 아직 저장 전이라 미스가 나고,
 * 같은 원본에 유료 이미지 호출($0.067)이 두 번 나갔다. 30장 상품이면 ~$2.
 */
import { describe, it, expect } from "vitest";
import { createKeyedLock } from "./keyedLock";

describe("createKeyedLock", () => {
  it("같은 키를 두 번 잡을 수 없다", () => {
    const lock = createKeyedLock();
    expect(lock.tryAcquire("a1")).toBe(true);
    expect(lock.tryAcquire("a1")).toBe(false);
  });

  it("다른 키는 서로 막지 않는다 — 나머지 자산은 정상 진행", () => {
    const lock = createKeyedLock();
    expect(lock.tryAcquire("a1")).toBe(true);
    expect(lock.tryAcquire("a2")).toBe(true);
  });

  it("놓으면 다시 잡을 수 있다 — 실패·중단이 영구 잠금이 되면 안 된다", () => {
    const lock = createKeyedLock();
    lock.tryAcquire("a1");
    lock.release("a1");
    expect(lock.tryAcquire("a1")).toBe(true);
  });

  it("run 은 작업이 끝나면 자동으로 놓는다", async () => {
    const lock = createKeyedLock();
    const r = await lock.run("a1", async () => "done");
    expect(r).toEqual({ ran: true, value: "done" });
    expect(lock.tryAcquire("a1")).toBe(true); // 이미 놓였다
  });

  it("run 은 작업이 던져도 놓는다 — 예외가 자산을 영구 잠그면 안 된다", async () => {
    const lock = createKeyedLock();
    await expect(
      lock.run("a1", async () => {
        throw new Error("번역 실패");
      }),
    ).rejects.toThrow("번역 실패");
    expect(lock.tryAcquire("a1")).toBe(true);
  });

  it("이미 진행 중이면 작업을 실행하지 않고 ran:false 를 돌려준다", async () => {
    const lock = createKeyedLock();
    let calls = 0;
    const work = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return "ok";
    };
    const [first, second] = await Promise.all([lock.run("a1", work), lock.run("a1", work)]);
    expect(first).toEqual({ ran: true, value: "ok" });
    expect(second).toEqual({ ran: false }); // 유료 호출이 두 번 나가지 않는다
    expect(calls).toBe(1);
  });

  it("겹친 실행이 끝난 뒤에는 다시 돌릴 수 있다", async () => {
    const lock = createKeyedLock();
    await lock.run("a1", async () => "1");
    const again = await lock.run("a1", async () => "2");
    expect(again).toEqual({ ran: true, value: "2" });
  });
});
