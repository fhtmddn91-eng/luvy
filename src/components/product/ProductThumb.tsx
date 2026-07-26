/* eslint-disable @next/next/no-img-element */
/**
 * 상품 썸네일. 업로드된 이미지가 있으면 표시하고,
 * 없으면 브랜드 기반의 결정적 파스텔 타일을 렌더한다.
 */
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

export function ProductThumb({
  id,
  brand,
  image,
  alt,
  className = "",
  compact = false,
}: {
  id: string;
  brand: string;
  image?: string;
  alt?: string;
  className?: string;
  /** 작은 썸네일(목록·미니 그리드)에서 브랜드명 대신 머리글자를 표시 */
  compact?: boolean;
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

  const palette = palettes[hash(id) % palettes.length];
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${palette} ${className}`}
    >
      <span
        className={
          compact
            ? "font-display text-[2.4em] leading-none tracking-tight text-white/85"
            : "max-w-full truncate px-1 text-[1.75em] font-extrabold tracking-tight text-white/80"
        }
      >
        {compact ? monogram(brand) : brand}
      </span>
    </div>
  );
}
