// vitest 전용 스텁 — 실제 "server-only" 는 Next 런타임 밖에서 import 되면 throw 한다.
// 서버 모듈(storage 등)을 단위 테스트하기 위해 빈 모듈로 대체한다.
export {};
