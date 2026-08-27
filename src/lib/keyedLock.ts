/**
 * 프로세스 안에서 같은 키의 작업이 겹쳐 도는 것을 막는 선점 잠금.
 *
 * **범위를 분명히 해 둔다: 프로세스 내 중복만 막는다. 분산 중복은 못 막는다.**
 * 다음 상황에서는 잠금이 공유되지 않아 같은 자산에 유료 호출이 두 번 나갈 수 있다:
 *   - 롤링 배포 중 구/신 인스턴스가 겹치는 순간
 *   - 재시작·크래시 직후 (이전 프로세스의 진행 중 작업을 새 프로세스가 모름)
 *   - replica 2개 이상으로 늘렸을 때
 *   - 스크립트 등 별도 Node 프로세스에서 같은 자산을 돌릴 때
 *
 * 완전한 해결은 DB 원자적 claim + lease 만료시각이다(ProductAsset 에 시작 시각
 * 컬럼 추가 → 마이그레이션 필요). 지금 이걸 안 넣은 이유는 두 가지다:
 * ① 만료 판정 없이 DB 상태만으로 잠그면 중단된 작업이 영구 잠겨 "판매 보류에서
 * 안 풀리는 상품"이 된다, ② 마이그레이션이 다른 미커밋 스키마 변경과 섞인다.
 * 프로세스가 죽으면 이 잠금은 통째로 사라지므로 재시작이 곧 복구이며,
 * 중단 흔적(TRANSLATING)을 다시 돌리는 기존 동작이 그대로 살아 있다.
 */
export interface KeyedLock {
  /** 잡았으면 true. 이미 누가 잡고 있으면 false */
  tryAcquire(key: string): boolean;
  release(key: string): void;
  /**
   * 잡고 실행한 뒤 반드시 놓는다.
   * 이미 진행 중이면 fn 을 **실행하지 않고** `{ ran: false }` — 유료 호출이
   * 두 번 나가는 걸 여기서 끊는다.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
}

export function createKeyedLock(): KeyedLock {
  const inFlight = new Set<string>();
  return {
    tryAcquire(key) {
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      return true;
    },
    release(key) {
      inFlight.delete(key);
    },
    async run(key, fn) {
      if (!this.tryAcquire(key)) return { ran: false };
      try {
        return { ran: true, value: await fn() };
      } finally {
        // 예외로 끝나도 놓는다 — 실패 한 번이 자산을 영구 잠그면 안 된다
        this.release(key);
      }
    },
  };
}
