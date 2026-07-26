# LUVY 배포 가이드 (GitHub → Railway)

Next.js 15 + Prisma + **PostgreSQL** 앱을 Railway에 배포하는 절차입니다.

---

## 0. 준비된 것 (코드에 이미 반영됨)

- `prisma/schema.prisma` — **PostgreSQL** provider
- `prisma/migrations/` — Postgres 마이그레이션 (커밋됨, 배포 시 자동 적용)
- `railway.json` — 빌드(Nixpacks) + 시작 시 `prisma migrate deploy` 자동 실행
- `package.json` — `postinstall: prisma generate`
- `.env`는 커밋되지 않음(gitignore). 실제 값은 Railway 환경변수로 주입.

---

## 1. GitHub(클라이언트 계정)로 push

리모트는 이미 등록돼 있습니다(`origin` → `https://github.com/fhtmddn91-eng/luvy.git`).
**클라이언트 계정 인증은 직접** 하셔야 합니다 (GitHub PAT를 비밀번호로 입력하거나 `gh auth login`).

빈 저장소인 경우:

```bash
git push -u origin main
```

저장소에 이미 커밋(README 등)이 있어 거부되면, 내용을 확인한 뒤 **의도적으로** 덮어쓸 때만:

```bash
git push -u origin main --force-with-lease
```

> ⚠️ `--force`는 원격 이력을 지웁니다. 클라이언트 저장소에 남길 내용이 있는지 먼저 확인하세요.

---

## 2. Railway 설정

### 2-1. 서비스 연결
Railway 프로젝트에서 이 GitHub 저장소를 소스로 연결합니다. `railway.json`이 있어
빌드/시작 명령은 자동입니다(별도 입력 불필요).

### 2-2. PostgreSQL 추가
프로젝트에 **+ New → Database → PostgreSQL** 을 추가합니다.

### 2-3. 환경변수 (앱 서비스 → Variables)

| 변수 | 값 | 필수 |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres 서비스 참조) | ✅ |
| `AUTH_SECRET` | 아래 명령으로 생성한 랜덤 문자열 | ✅ (없으면 앱이 시작되지 않음) |
| `ADMIN_ID` | 관리자 로그인 아이디 (예: `luvyb2b`) | 관리자 자동 생성 시 |
| `ADMIN_PW` | 관리자 비밀번호 | 관리자 자동 생성 시 |
| `ANTHROPIC_API_KEY` | Claude API 키 | 1688 수집 시 AI 번역·카테고리 자동분류를 쓸 때만 |
| `PORTONE_STORE_ID` | 포트원 상점코드 | 결제 켤 때만 |
| `PORTONE_CHANNEL_KEY_KCP` | KCP 채널 키 | 결제 켤 때만 |
| `PORTONE_API_SECRET` | 포트원 V2 API Secret | 결제 켤 때만 |
| `PORTONE_WEBHOOK_SECRET` | 포트원 웹훅 시크릿 | 결제 켤 때만 |

`AUTH_SECRET` 생성:

```bash
openssl rand -hex 32
```

> 포트원 4개를 비워두면 체크아웃은 **모의 주문**으로 동작합니다(결제창 없이 "주문 접수").
> 4개를 모두 채우면 실제 KCP 결제창 모드로 자동 전환됩니다.

### 2-4. 배포
push하면 Railway가 자동 빌드→배포합니다. 시작 시 `prisma migrate deploy`가
스키마를 적용하므로 **테이블은 자동 생성**됩니다.

### 2-5. 관리자 계정 (자동 생성)
Variables 탭에 `ADMIN_ID`, `ADMIN_PW` 를 넣고 재배포하면, 시작 시
`npm run set:admin` 이 실행되어 해당 아이디/비밀번호로 **관리자 계정을 자동 생성·갱신**합니다
(셸 접속 불필요, 비밀번호는 bcrypt 해시로만 저장). 값이 없으면 조용히 건너뜁니다.
로그인은 `/login` 에서 아이디(또는 이메일) + 비밀번호로 합니다.

> 비밀번호는 저장소(git)에 넣지 마세요. 반드시 Railway Variables 로만 관리하세요.
> 변경하려면 `ADMIN_PW` 값을 바꾸고 재배포하면 됩니다.

---

## 3. 초기 데이터 시드 (선택)

빈 DB로 시작하면 상품·배너·공지·데모계정이 없습니다. 데모/QA용으로 채우려면
Railway 앱 서비스 셸에서 한 번 실행:

```bash
npm run db:seed
```

시드 계정: 관리자 `admin@luvy.co.kr` / `admin1234`, 회원 `demo@luvy.co.kr` / `luvy1234`
**운영 전 반드시 비밀번호를 바꾸거나 계정을 교체하세요.**

초기 상품 5종(메이드복 / 문라이트 박스 / 블러쉬펀 2종 / 퍼플 바니걸)을
**HIDDEN(숨김) 상태**로 등록하려면:

```bash
npm run db:templates
```

- 상품명만 확정된 상태이며 **브랜드·카테고리·도매가는 임시값**입니다.
- 어드민 → 상품 관리에서 사진·가격·설명을 채운 뒤 **"판매"로 전환**하세요.
- 같은 이름이 이미 있으면 건너뛰므로 여러 번 실행해도 중복 생성되지 않습니다.

관리자는 `/admin`에서 상품·주문·회원·배너·공지를 관리합니다.

---

## 4. 로컬 개발 (참고)

로컬도 이제 PostgreSQL이 필요합니다.

```bash
createdb luvy_dev
```

`.env`의 `DATABASE_URL`을 로컬 Postgres로 지정 후:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

---

## 5. 상품 이미지 업로드 주의

어드민에서 업로드한 상품 이미지는 `public/uploads/`(서버 로컬 디스크)에 저장됩니다.
**Railway 기본 파일시스템은 재배포 시 초기화**되므로 업로드 이미지가 사라집니다.
운영에서 이미지를 보존하려면 둘 중 하나를 적용하세요:

- Railway **Volume**을 앱 서비스의 `/app/public/uploads` 에 마운트, 또는
- `src/lib/storage.ts` 를 S3/R2 등 외부 스토리지 드라이버로 교체 (이 파일만 바꾸면 됨)

**가입 시 첨부되는 사업자등록증**도 파일(`/app/private-uploads`)로 저장되므로
같은 방식으로 Volume 마운트가 필요합니다. (관리자만 열람 가능, 공개 URL 없음)

## 6. 502 / 앱이 안 뜰 때 (부팅 단계 확인)

시작 명령은 단계마다 마커를 찍습니다. Railway → **Deploy Logs** 에서
마지막으로 보이는 마커가 어디서 멈췄는지를 알려줍니다.

| 마지막 마커 | 의미 | 조치 |
|---|---|---|
| 마커 없음 | 빌드 실패 (배포까지 못 감) | **Build Logs** 확인 |
| `[boot] 1/3 migrate` 까지 | `prisma migrate deploy` 실패 | `DATABASE_URL` 이 `${{Postgres.DATABASE_URL}}` 참조인지, Postgres 서비스가 있는지 확인 |
| `[boot] 3/3 start` 후 크래시 | 앱 실행 중 오류 | `AUTH_SECRET` 미설정 여부 확인 (없으면 프로덕션에서 즉시 종료) |
| `Ready in ...` 까지 나오는데 502 | 앱은 정상, 도메인/프록시 문제 | Railway 기본 도메인(`*.up.railway.app`)으로 먼저 접속해보고, Cloudflare CNAME·SSL 모드(**Full**) 확인 |

> `set:admin` 은 실패해도 앱 시작을 막지 않습니다(`|| true`).

---

## 7. 배포 후 점검

- `/` 메인 로드 (배너·공지 노출)
- `/login` 로그인 → 회원전용 경로 접근
- `/admin` 관리자 로그인 → 대시보드
- 로그에 `AUTH_SECRET` 관련 크래시가 없는지 (없으면 미설정 → 환경변수 추가)

---

## 8. 1688 상품 수집 (`/admin/import`)

1688 상세 HTML은 알리바바 봇 차단(X5Sec)이 걸려 **서버에서 직접 크롤링할 수 없습니다.**
대신 관리자가 로그인한 브라우저에서 데이터를 추출해 넘기는 구조입니다.

```
[관리자 브라우저 — 1688 로그인 상태]
  북마클릿 실행 → 제목·가격구간·이미지/GIF URL 추출 → 클립보드 복사
        ↓ (붙여넣기)
[LUVY 서버]
  파싱(호스트 화이트리스트) → 이미지·GIF 미러링 → AI 번역/분류 → 상품 초안(숨김·0원)
```

- 이미지 CDN(`*.alicdn.com`)은 차단이 없어 **서버가 직접 내려받습니다.**
- GIF는 리사이즈 접미사를 떼어 **움직이는 원본**으로 받습니다.
- 수집 상품은 항상 `HIDDEN` + 가격 0원 → 도매가 입력 후 판매 전환.
- 같은 `offerId`는 재수집되지 않습니다(`Product.sourceId` 유니크).
- 수집한 이미지는 `public/uploads`, 즉 **Volume 마운트 대상**입니다(5번 항목 참고).

### 보안 메모
- 수집 payload는 외부(브라우저)에서 오므로 `alicdn.com` 이외 호스트는 거부합니다.
  (내부망 주소를 넣어 서버가 긁게 만드는 SSRF 차단 — 단위 테스트로 고정)
- 세션 쿠키가 `SameSite=Lax` 이므로 1688 도메인에서 LUVY로 직접 POST하는 방식은
  쓰지 않았습니다. 쿠키를 완화하면 사이트 전체 CSRF 방어가 약해집니다.

---

## 9. 재고 관리

상품별로 **재고 관리 사용**을 켜면 재고 수량만큼만 주문받고 0이 되면 자동 품절 처리됩니다.
주문 후 사입하는 무재고 상품은 꺼두면 됩니다(기존 상품은 모두 꺼진 상태).

| 시점 | 동작 |
|---|---|
| 주문(모의 결제) | 주문 생성과 **같은 트랜잭션**에서 재고 차감 |
| 결제창 호출 전 | 재고를 **선점**(차감) — 결제 후 차감하면 "돈 받고 못 보내는" 상황이 생김 |
| 결제 실패 | 선점분 복원 |
| 관리자 주문 취소 | 복원 (이미 취소된 주문은 중복 복원 안 됨) |

### 초과판매 방지
조건부 `updateMany`("재고가 요청 수량 이상인 행만 감소")로 차감하고 영향 행 수를 확인합니다.
읽고→판단→쓰기 방식은 그 사이에 다른 주문이 끼어들어 음수 재고가 되므로 쓰지 않습니다.
`src/lib/stockOps.test.ts` 가 동시 주문·부분 실패·중복 복원을 실제 DB로 검증합니다.

> MOQ보다 재고가 적으면 재고만큼만 주문 가능합니다(MOQ까지 강제로 올리면 초과판매).
