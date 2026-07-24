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

실제 상품 정보를 입력할 **빈 템플릿 상품 5개**(HIDDEN 상태)가 필요하면:

```bash
npm run db:templates
```

어드민 → 상품 관리에서 `[템플릿]` 상품을 수정해 내용을 채운 뒤 "판매"로 전환하세요.

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

## 6. 배포 후 점검

- `/` 메인 로드 (배너·공지 노출)
- `/login` 로그인 → 회원전용 경로 접근
- `/admin` 관리자 로그인 → 대시보드
- 로그에 `AUTH_SECRET` 관련 크래시가 없는지 (없으면 미설정 → 환경변수 추가)
