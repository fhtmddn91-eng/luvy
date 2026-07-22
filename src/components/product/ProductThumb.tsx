/** 실제 상품 사진이 없어 브랜드 이니셜 기반의 결정적 파스텔 타일을 렌더한다. */
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

export function ProductThumb({ id, brand, className = "" }: { id: string; brand: string; className?: string }) {
  const palette = palettes[hash(id) % palettes.length];
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${palette} ${className}`}>
      <span className="text-[28px] font-extrabold tracking-tight text-white/80">{brand}</span>
    </div>
  );
}
