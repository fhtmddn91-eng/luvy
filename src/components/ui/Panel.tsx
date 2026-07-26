import Link from "next/link";

/**
 * 프리미엄 UI 공용 프리미티브.
 * 무거운 카드 대신 헤어라인 + 넉넉한 여백으로 영역을 나눈다.
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
    <header className="rise mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow font-display">{eyebrow}</p>}
        <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink-deep sm:text-[30px]">
          {title}
        </h1>
        {description && <p className="mt-2 text-[13px] text-muted">{description}</p>}
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
    <section
      className={`overflow-hidden rounded-2xl border border-hairline bg-white shadow-[var(--shadow-lift)] ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-hairline-soft px-5 py-4 sm:px-6">
          {title && <h2 className="text-[14px] font-bold tracking-[-0.01em] text-ink-deep">{title}</h2>}
          {action}
        </div>
      )}
      <div className={flush ? "" : "px-5 py-5 sm:px-6"}>{children}</div>
    </section>
  );
}

/** 큰 지표 — 숫자는 세리프로 눌러 담아 백화점 리포트 같은 인상을 준다 */
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
      <p className="mt-3 flex items-baseline gap-1 text-ink-deep">
        <span className="font-display text-[34px] leading-none tracking-[-0.02em] sm:text-[40px]">
          {value}
        </span>
        {suffix && <span className="text-[13px] font-semibold text-ink-soft">{suffix}</span>}
      </p>
      {hint && <p className="mt-2 text-[12px] text-muted">{hint}</p>}
    </>
  );

  const cls =
    "block rounded-2xl border border-hairline bg-white px-5 py-5 shadow-[var(--shadow-lift)] transition-colors";

  return href ? (
    <Link href={href} className={`${cls} hover:border-brand-300`}>
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
      className={`inline-flex whitespace-nowrap rounded-pill px-2.5 py-1 text-[11px] font-bold tracking-[0.01em] ${tone}`}
    >
      {children}
    </span>
  );
}

/** 표는 좁은 화면에서 가로 스크롤 */
export function TableWrap({ minWidth = 720, children }: { minWidth?: number; children: React.ReactNode }) {
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
      className={`whitespace-nowrap px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted sm:px-6 ${alignCls[align]} ${className}`}
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
    <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap rounded-pill border px-4 py-1.5 text-[13px] transition-colors ${
            t.active
              ? "border-ink-deep bg-ink-deep font-bold text-white"
              : "border-hairline bg-white font-medium text-ink-soft hover:border-ink-deep hover:text-ink-deep"
          }`}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span className={`ml-1.5 ${t.active ? "text-white/70" : "text-muted"}`}>{t.count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

/** 어드민 기본 버튼 — 실선(주요) / 외곽선(보조) */
export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-pill bg-ink-deep px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-brand-600 disabled:opacity-60";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-pill border border-hairline bg-white px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep";

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-6 py-16 text-center text-[14px] text-muted">{children}</div>
  );
}
