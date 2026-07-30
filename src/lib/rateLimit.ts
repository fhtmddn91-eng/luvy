/**
 * 슬라이딩 윈도우 시도 제한.
 *
 * 로그인에 제한이 없으면 공격자가 흔한 비밀번호로 초당 수백 번을 시도할 수 있다.
 * bcrypt 가 느려서 어느 정도 방어가 되지만, 그건 서버 CPU 를 태우는 방식의 방어라
 * 오히려 DoS 가 된다. 그래서 시도 자체를 세어 막는다.
 *
 * 저장소는 프로세스 메모리다. 인스턴스가 여러 대면 대수만큼 한도가 늘어나므로,
 * 완벽한 차단이 아니라 "자동화 공격의 비용을 올리는" 장치로 본다.
 * (Redis 를 붙이면 이 파일만 교체하면 된다)
 */

export interface RateLimitRule {
  /** 윈도우 동안 허용할 시도 횟수 */
  limit: number;
  /** 윈도우 길이 (ms) */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 남은 시도 횟수 */
  remaining: number;
  /** 차단된 경우, 다시 시도할 수 있을 때까지 남은 초 */
  retryAfterSec: number;
}

/** key -> 시도 시각(ms) 목록 */
type Store = Map<string, number[]>;

const globalStore: Store = new Map();

/** 메모리 누수 방지: 윈도우가 지난 기록은 조회할 때마다 정리한다. */
function prune(hits: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  // 오래된 것이 앞쪽에 몰려 있으므로 앞에서부터 잘라낸다
  let i = 0;
  while (i < hits.length && hits[i] <= cutoff) i++;
  return i === 0 ? hits : hits.slice(i);
}

/**
 * 시도를 1회 기록하고 허용 여부를 돌려준다.
 * 실패한 시도만 세는 용도라면 성공 시 `reset()` 을 호출한다.
 */
export function hit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
  store: Store = globalStore,
): RateLimitResult {
  const pruned = prune(store.get(key) ?? [], now, rule.windowMs);

  if (pruned.length >= rule.limit) {
    store.set(key, pruned);
    const oldest = pruned[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfterSec };
  }

  pruned.push(now);
  store.set(key, pruned);
  return { ok: true, remaining: rule.limit - pruned.length, retryAfterSec: 0 };
}

/** 성공 시 카운터를 비운다 (정상 사용자가 다음 로그인에서 불이익을 받지 않게) */
export function reset(key: string, store: Store = globalStore): void {
  store.delete(key);
}

/** 기록만 조회 (테스트·진단용) */
export function count(key: string, rule: RateLimitRule, now = Date.now(), store: Store = globalStore): number {
  return prune(store.get(key) ?? [], now, rule.windowMs).length;
}

/** 사람이 읽을 안내 문구 */
export function retryMessage(sec: number): string {
  if (sec >= 60) return `${Math.ceil(sec / 60)}분 후 다시 시도해주세요.`;
  return `${sec}초 후 다시 시도해주세요.`;
}

/* ── 실제 적용할 규칙 ────────────────────────────── */

/** 계정당 로그인 실패 — 특정 계정을 노린 공격 */
export const LOGIN_PER_ACCOUNT: RateLimitRule = { limit: 5, windowMs: 10 * 60_000 };
/** IP당 로그인 실패 — 여러 계정을 훑는 공격 */
export const LOGIN_PER_IP: RateLimitRule = { limit: 20, windowMs: 10 * 60_000 };
/** IP당 회원가입 — 봇 대량 가입 */
export const SIGNUP_PER_IP: RateLimitRule = { limit: 5, windowMs: 60 * 60_000 };
/** IP당 문의 등록 — 스팸 */
export const INQUIRY_PER_IP: RateLimitRule = { limit: 10, windowMs: 60 * 60_000 };
