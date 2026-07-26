import Link from "next/link";

/**
 * 어드민 / 마이페이지 공용 프리미티브.
 * 미니멀 모노크롬 — 각진 모서리, 그림자 없음, 헤어라인으로만 면을 나눈다.
 */

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="rise mb-9 flex flex-wrap items-end justify-between gap-4 border-b border-ink-deep pb-5">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-2.5 text-[24px] font-bold leading-none tracking-[-0.035em] text-ink-deep sm:text-[28px]">
          {title}
        </h1>
        {description && <p className="mt-3 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Panel({
  title,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 표처럼 내부에서 자체 패딩을 갖는 경우 본문 패딩을 없앤다 */
  flush?: boolean;
}) {
  return (
    <section className={`border border-hairline bg-white ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-6">
          {title && (
            <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-deep">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      <div className={flush ? "" : "px-5 py-5 sm:px-6"}>{children}</div>
    </section>
  );
}

/** 큰 지표 */
export function StatTile({
  label,
  value,
  suffix,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-4 flex items-baseline gap-1 text-ink-deep">
        <span className="font-display text-[32px] leading-none sm:text-[36px]">{value}</span>
        {suffix && <span className="text-[12px] font-semibold text-muted">{suffix}</span>}
      </p>
      {hint && <p className="mt-2 text-[12px] text-muted">{hint}</p>}
    </>
  );

  const cls = "block border border-hairline bg-white px-5 py-5 transition-colors";

  return href ? (
    <Link href={href} className={`${cls} hover:border-ink-deep`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * 상태 배지. tone 은 완성된 Tailwind 클래스 문자열을 받는다
 * (lib/orderStatus, lib/memberStatus 의 tone 값을 그대로 넘기면 됨).
 */
export function StatusPill({
  tone = "bg-hairline-soft text-ink-soft",
  children,
}: {
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em] ${tone}`}
    >
      {children}
    </span>
  );
}

/** 표는 좁은 화면에서 가로 스크롤 */
export function TableWrap({
  minWidth = 720,
  children,
}: {
  minWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

// Tailwind가 클래스명을 정적으로 스캔하므로 문자열 조합 대신 매핑을 쓴다
const alignCls = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: React.ReactNode;
  align?: keyof typeof alignCls;
  className?: string;
}) {
  return (
    <th
      className={`whitespace-nowrap px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted sm:px-6 ${alignCls[align]} ${className}`}
    >
      {children}
    </th>
  );
}

export function FilterTabs({
  items,
}: {
  items: { href: string; label: string; active: boolean; count?: number }[];
}) {
  return (
    <div className="no-scrollbar mb-5 flex gap-0 overflow-x-auto border-b border-hairline">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-[13px] transition-colors ${
            t.active
              ? "border-ink-deep font-bold text-ink-deep"
              : "border-transparent font-medium text-muted hover:text-ink-deep"
          }`}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span className="ml-1.5 font-display text-muted">{t.count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

/** 버튼 — 각진 형태, 블랙 / 아웃라인 */
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 bg-ink-deep px-6 py-3 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 border border-ink-deep bg-white px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-deep transition-colors hover:bg-ink-deep hover:text-white";

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-20 text-center text-[13px] text-muted">{children}</div>;
}
