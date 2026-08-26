/* eslint-disable @next/next/no-img-element */
/**
 * 상품 썸네일. 업로드된 이미지가 있으면 표시하고,
 * 없으면 브랜드 기반의 결정적 파스텔 타일을 렌더한다.
 */
import { isPlaceholderBrand } from "@/lib/productPublishGate";

const palettes = [
  "from-brand-100 to-brand-200",
  "from-brand-50 to-brand-100",
  "from-brand-200 to-brand-300",
  "from-cream to-brand-100",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 작은 타일에서는 브랜드명이 뭉개지므로 머리글자만 쓴다 */
function monogram(brand: string): string {
  const trimmed = brand.trim();
  if (!trimmed) return "·";
  // 영문은 두 글자까지, 한글은 한 글자
  return /^[A-Za-z]/.test(trimmed) ? trimmed.slice(0, 2).toUpperCase() : trimmed.slice(0, 1);
}

/** 모노크롬 화면(어드민)에서 쓰는 무채색 대체 타일 */
const neutralPalettes = [
  "from-[#ededed] to-[#e0e0e0]",
  "from-[#f3f3f3] to-[#e6e6e6]",
  "from-[#e8e8e8] to-[#dadada]",
  "from-[#f0f0f0] to-[#e3e3e3]",
];

export function ProductThumb({
  id,
  brand,
  image,
  alt,
  className = "",
  compact = false,
  tone = "brand",
}: {
  id: string;
  brand: string;
  image?: string;
  alt?: string;
  className?: string;
  /** 작은 썸네일(목록·미니 그리드)에서 브랜드명 대신 머리글자를 표시 */
  compact?: boolean;
  /** 어드민처럼 모노크롬 화면에서는 "neutral" */
  tone?: "brand" | "neutral";
}) {
  if (image) {
    return (
      <div className={`relative overflow-hidden bg-cream ${className}`}>
        <img
          src={image}
          alt={alt ?? ""}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  const tileLabel = isPlaceholderBrand(brand) ? (alt ?? "") : brand;
  const set = tone === "neutral" ? neutralPalettes : palettes;
  const palette = set[hash(id) % set.length];
  const textCls = tone === "neutral" ? "text-ink-deep/45" : "text-white/85";
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${palette} ${className}`}
    >
      <span
        className={
          compact
            ? `font-display text-[2.4em] leading-none tracking-tight ${textCls}`
            : `max-w-full truncate px-1 text-[1.75em] font-extrabold tracking-tight ${tone === "neutral" ? "text-ink-deep/40" : "text-white/80"}`
        }
      >
        {/* 브랜드가 자리표시자("미정")면 타일에 상품명을 쓴다 — 이미지 없는 상품에서
            "미정"이 큰 글씨로 손님에게 노출됐다 (2026-08-24 브라우저 검증에서 발견) */}
        {compact ? monogram(tileLabel) : tileLabel}
      </span>
    </div>
  );
}
