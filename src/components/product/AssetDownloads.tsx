import { Icon } from "@/components/ui/Icon";

export interface AssetRow {
  id: string;
  kind: string;
  url: string;
  bytes: number;
}

const KIND_LABEL: Record<string, string> = {
  MAIN: "대표 이미지",
  DETAIL: "상세 이미지",
  GIF: "움직이는 이미지 (GIF)",
  OPTION: "옵션 이미지",
};

const ORDER = ["MAIN", "DETAIL", "GIF", "OPTION"];

/** 묶음 다운로드 단위 — 서버 라우트의 kind 파라미터와 짝을 맞춘다. */
const BUNDLES: { kind: string; label: string; kinds: string[] }[] = [
  { kind: "MAIN", label: "대표이미지 전체", kinds: ["MAIN"] },
  { kind: "DETAIL", label: "상세페이지 전체", kinds: ["DETAIL", "GIF", "OPTION"] },
];

function kb(bytes: number): string {
  if (bytes <= 0) return "";
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`;
}

/**
 * 상품 판매자료 다운로드.
 * 승인 회원만 볼 수 있는 상품 페이지 안에 있으므로 별도 권한 검사는 하지 않는다.
 */
export function AssetDownloads({
  productId,
  assets,
}: {
  productId: string;
  assets: AssetRow[];
}) {
  if (assets.length === 0) return null;

  const groups = ORDER.map((kind) => ({
    kind,
    items: assets.filter((a) => a.kind === kind),
  })).filter((g) => g.items.length > 0);

  const total = assets.reduce((sum, a) => sum + a.bytes, 0);

  // 자료가 한 종류뿐이면 묶음 버튼이 두 개 있을 이유가 없다
  const bundles = BUNDLES.map((b) => {
    const items = assets.filter((a) => b.kinds.includes(a.kind));
    return { ...b, count: items.length, bytes: items.reduce((s, a) => s + a.bytes, 0) };
  }).filter((b) => b.count > 0);

  return (
    <section className="mt-12 border-t border-line pt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-extrabold text-ink">판매자료 다운로드</h2>
          <p className="mt-1 text-[13px] text-muted">
            상세페이지·썸네일·GIF 원본을 내려받아 판매 채널에 바로 사용하세요.
          </p>
        </div>
        <p className="text-[12px] text-muted">
          총 {assets.length}개{total > 0 ? ` · ${kb(total)}` : ""}
        </p>
      </div>

      {/* 원클릭 묶음 저장 — 한 장씩 저장하면 상세 20장에 20번 클릭이 든다 */}
      <div className="mb-6 flex flex-wrap gap-2">
        {bundles.map((b) => (
          <a
            key={b.kind}
            href={`/api/products/${productId}/assets.zip?kind=${b.kind}`}
            className="inline-flex items-center gap-2 rounded-pill bg-brand-500 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-brand-600"
          >
            <Icon name="download" className="h-4 w-4" strokeWidth={2.2} />
            {b.label}
            <span className="font-semibold opacity-80">
              {b.count}장{b.bytes > 0 ? ` · ${kb(b.bytes)}` : ""}
            </span>
          </a>
        ))}
        {bundles.length > 1 && (
          <a
            href={`/api/products/${productId}/assets.zip?kind=ALL`}
            className="inline-flex items-center gap-2 rounded-pill border border-line bg-white px-4 py-2.5 text-[13px] font-bold text-ink-soft transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Icon name="download" className="h-4 w-4" strokeWidth={2.2} />
            전체 ZIP
          </a>
        )}
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.kind}>
            <p className="mb-2.5 text-[12px] font-bold uppercase tracking-[0.1em] text-muted">
              {KIND_LABEL[g.kind] ?? g.kind}
              <span className="ml-1.5 font-medium normal-case tracking-normal">
                {g.items.length}개
              </span>
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.items.map((a) => (
                <li key={a.id} className="group">
                  <a href={a.url} download className="block">
                    <div className="relative overflow-hidden rounded-xl border border-line bg-cream">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.url}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-cover transition-opacity group-hover:opacity-85"
                      />
                      {a.kind === "GIF" && (
                        <span className="absolute left-2 top-2 rounded-pill bg-ink/80 px-2 py-0.5 text-[10px] font-extrabold text-white">
                          GIF
                        </span>
                      )}
                    </div>
                    <span className="mt-1.5 flex items-center justify-between text-[12px] text-muted">
                      <span className="flex items-center gap-1 font-semibold text-ink-soft group-hover:text-brand-600">
                        <Icon name="download" className="h-3.5 w-3.5" strokeWidth={2} />
                        저장
                      </span>
                      {kb(a.bytes) && <span>{kb(a.bytes)}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
