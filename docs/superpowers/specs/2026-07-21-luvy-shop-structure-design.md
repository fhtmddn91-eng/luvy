# LUVY B2B 쇼핑몰 — 구조 설계 및 메인 페이지 스펙

- 작성일: 2026-07-21
- 범위: 프론트엔드 구조 설계 + 메인 페이지 화면 구현
- 기술 스택: Next.js (App Router) + TypeScript + Tailwind CSS

## 1. 목표

성인용품 B2B 쇼핑몰 "LUVY"의 프론트엔드 구조를 도메인 중심으로 설계하고,
제공된 메인 페이지 디자인(스크린샷)을 우선 구현한다. 백엔드는 이번 범위에서
제외하며, 데이터는 목데이터로 대체하고 나중에 API로 교체 가능한 구조로 만든다.

## 2. 아키텍처 원칙

- **도메인 중심 구성**: `product`, `cart`, `auth`, `layout`, `home` 등 도메인
  단위로 컴포넌트/타입/목데이터를 묶는다. 페이지(`app/`)는 조립만 담당한다.
- **교체 가능한 데이터 경계**: 페이지는 `lib/mock/`에서 데이터를 가져온다.
  API 도입 시 이 지점만 fetch로 교체한다.
- **단일 책임 컴포넌트**: 각 컴포넌트는 하나의 명확한 역할을 갖고, props로만
  소통하며 독립적으로 이해/테스트 가능해야 한다.

## 3. 폴더 구조

```
luvy/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # 공통 레이아웃 (Header + CategoryBar + Footer)
│   │   ├── page.tsx                   # 메인 (이번 범위)
│   │   ├── category/[slug]/page.tsx   # 카테고리별 상품 목록 (다음 단계)
│   │   ├── search/page.tsx            # 검색 결과 (다음 단계)
│   │   ├── products/[id]/page.tsx     # 상품 상세 (다음 단계)
│   │   ├── cart/page.tsx              # 장바구니 (다음 단계)
│   │   ├── checkout/page.tsx          # 주문/결제 (다음 단계)
│   │   ├── orders/page.tsx            # 주문 조회 (다음 단계)
│   │   └── (auth)/
│   │       ├── login/page.tsx         # 로그인 (다음 단계)
│   │       └── signup/page.tsx        # 회원가입 - B2B 사업자 인증 (다음 단계)
│   │
│   ├── components/
│   │   ├── layout/    # UtilBar, Header, Gnb, SearchBar, CategoryBar, Footer
│   │   ├── home/      # HeroBanner, TrustBadges, NoticeStrip, FeatureGrid
│   │   ├── product/   # ProductCard, ProductGrid, PriceTag (다음 단계)
│   │   ├── cart/      # CartItem, CartSummary (다음 단계)
│   │   └── ui/        # Button, Input, Badge, IconButton 등 범용
│   │
│   ├── lib/
│   │   ├── types.ts                   # Product, Category, CartItem, User, Order
│   │   ├── mock/                      # categories.ts, banners.ts, notices.ts, features.ts
│   │   └── store/cart.ts              # 장바구니 상태 (Zustand + localStorage, 다음 단계)
│   │
│   └── styles/globals.css             # Tailwind + LUVY 브랜드 토큰
└── tailwind.config.ts
```

## 4. 메인 페이지 화면 구조 (스크린샷 기준)

위에서부터 순서대로:

1. **UtilBar** (최상단 연핑크 바)
   - 좌: 트럭 아이콘 + "빠르고 안전한 B2B 배송 시스템"
   - 우: 로그인 | 회원가입 | 장바구니 | 주문조회 | 고객센터
2. **Header**
   - 좌: LUVY 로고
   - 중앙: GNB — 카테고리▾, 브랜드, 신상품, 베스트, 기획전, 고객지원, 파트너센터
   - 우: 검색창(placeholder "상품명 또는 키워드를 검색하세요") + 검색 아이콘,
     장바구니 아이콘(수량 뱃지 0)
3. **CategoryBar**
   - 좌: 햄버거 + "전체 카테고리"
   - 우: 아이콘 카테고리 8종 — 여성용품, 남성용품, 커플 & SM, 애널용품,
     마사지 & 로션, 콘돔 & 윤활제, 아이디어 상품, 브랜드관
4. **HeroBanner** (캐러셀)
   - 좌: "LOVE YOUR BUSINESS" 라벨 + "LUVY, 당신의 비즈니스를 더 빛나게" 헤드라인
     + 서브카피 2줄 + CTA 2개(회원가입하고 혜택받기 / B2B 안내 보기)
   - 우: 제품 이미지(플레이스홀더)
   - 좌우 화살표 네비 + 하단 도트 인디케이터(5개)
   - 배너 하단 신뢰 요소 4종: 정품 보장 / 빠른 배송 / 전담 파트너 지원 / 안전한 거래
5. **NoticeStrip** (3열)
   - 공지사항: "2024 추석 연휴 배송 및 고객센터 운영 안내"
   - 입고 소식: "인기 브랜드 신상품 입고 안내"
   - 이벤트: "신규 회원 가입 시 10,000P 지급"
   - 우측 "더보기 >"
6. **FeatureGrid** (푸터 상단, 6열)
   - 신뢰할 수 있는 B2B 플랫폼 / 다양한 제품 & 브랜드 / 경쟁력 있는 가격 /
     안정적인 물류 시스템 / 성공을 위한 파트너십 (각 아이콘 + 제목 + 설명)

## 5. 컴포넌트 명세 (메인)

| 컴포넌트 | 역할 | 주요 props / 데이터원 |
|---|---|---|
| `UtilBar` | 상단 유틸 링크 바 | 정적 |
| `Header` | 로고 + GNB + 검색 + 장바구니 | 장바구니 수량(store) |
| `Gnb` | 주 네비게이션 링크 | 링크 배열(정적) |
| `SearchBar` | 검색 입력 + 버튼 | onSearch (다음 단계 연결) |
| `CategoryBar` | 아이콘 카테고리 나열 | `mock/categories.ts` |
| `HeroBanner` | 캐러셀 배너 | `mock/banners.ts` |
| `TrustBadges` | 신뢰 요소 4종 | 정적 배열 |
| `NoticeStrip` | 공지/입고/이벤트 3열 | `mock/notices.ts` |
| `FeatureGrid` | B2B 강점 6종 | `mock/features.ts` |
| `Footer` | 하단 정보/링크 | 정적 |

## 6. 데이터 / 상태 흐름

- 이번 단계: 백엔드 없이 `lib/mock/`의 목데이터를 페이지에서 직접 import.
- 장바구니 상태는 다음 단계에서 Zustand + localStorage로 구현하고 헤더 뱃지와 연동.
  이번 메인 구현에서는 뱃지 수량 0(정적)으로 표시.
- 검색/카테고리 클릭 등 네비게이션 핸들러는 라우트만 연결(대상 페이지는 다음 단계).

## 7. 디자인 토큰

스크린샷 톤을 Tailwind 테마로 정의:

- 브랜드 핑크: `#E8467C` 계열(포인트), 연핑크 배경 `#FCE7EF` / `#FDF2F6`
- 텍스트: 진한 그레이 `#333` 계열, 보조 텍스트 회색
- 라운드: pill 버튼(전체 라운드), 카드 `rounded-2xl`
- 폰트: Pretendard (한글 가독성)
- 아이콘: 라인 스타일(예: lucide-react)

## 8. 구현 순서

1. 프로젝트 셋업(Next.js + TS + Tailwind) + 디자인 토큰 + 폰트
2. 공통 레이아웃: UtilBar, Header/Gnb/SearchBar, CategoryBar, Footer
3. 메인 페이지: HeroBanner(캐러셀) + TrustBadges + NoticeStrip + FeatureGrid
4. (다음 단계) 상품 목록/상세 → 장바구니/주문 → 로그인/회원가입

## 9. 비범위 (이번 단계 제외)

- 실제 백엔드/DB/인증
- 결제 연동
- 장바구니 실제 담기 로직(구조만 준비)
- 반응형 세부 대응은 데스크톱 우선, 모바일은 다음 단계에서 정교화

## 10. 성공 기준

- `npm run dev`로 실행 시 메인 페이지가 스크린샷과 동일한 섹션 구성/순서로 렌더링된다.
- 헤더/카테고리바/푸터가 공통 레이아웃으로 분리되어 다른 페이지에서 재사용 가능하다.
- 모든 표시 데이터가 `lib/mock/`에서 오며, 컴포넌트는 하드코딩된 콘텐츠 대신
  데이터를 받아 렌더링한다.
