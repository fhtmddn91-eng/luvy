/* eslint-disable @next/next/no-img-element */
/**
 * 상품 썸네일. 업로드된 이미지가 있으면 표시하고,
 * 없으면 브랜드 이니셜 기반의 결정적 파스텔 타일을 렌더한다.
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

export function ProductThumb({
  id,
  brand,
  image,
  alt,
  className = "",
}: {
  id: string;
  brand: string;
  image?: string;
  alt?: string;
  className?: string;
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
    <div className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${palette} ${className}`}>
      <span className="text-[1.75em] font-extrabold tracking-tight text-white/80">{brand}</span>
    </div>
  );
}
