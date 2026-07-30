import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { auditLabel, isCritical, actionsForGroup, AUDIT_GROUPS } from "@/lib/auditActions";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
  FilterTabs,
} from "@/components/ui/Panel";

const PAGE_SIZE = 50;

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);

const targetLink = (target: string, id: string): string | null => {
  if (!id) return null;
  if (target === "order") return `/admin/orders/${id}`;
  if (target === "member") return `/admin/members/${id}`;
  if (target === "product") return `/admin/products/${id}`;
  return null;
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const group = sp.group && AUDIT_GROUPS.some((g) => g.key === sp.group) ? sp.group : "ALL";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);

  const actions = group === "ALL" ? [] : actionsForGroup(group);
  const where = {
    ...(actions.length > 0 ? { action: { in: actions } } : {}),
    ...(q
      ? {
          OR: [
            { actorName: { contains: q } },
            { summary: { contains: q } },
            { targetId: { contains: q.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.auditLog.count({ where }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (group !== "ALL") p.set("group", group);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div>
      <PageHeader
        eyebrow="Security"
        title="감사 로그"
        description={`${total.toLocaleString("ko-KR")}건 — 승인·취소·환불·비밀번호 발급 등 되돌리기 어려운 동작의 기록`}
      />

      <div className="rise rise-1">
        <FilterTabs
          items={[
            { href: `/admin/audit${qs({ group: "", page: 0 })}`, label: "전체", active: group === "ALL" },
            ...AUDIT_GROUPS.map((g) => ({
              href: `/admin/audit?group=${g.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
              label: g.label,
              active: group === g.key,
            })),
          ]}
        />
      </div>

      <form className="rise rise-1 mb-4" action="/admin/audit">
        {group !== "ALL" && <input type="hidden" name="group" value={group} />}
        <div className="relative max-w-sm">
          <input
            name="q"
            defaultValue={q}
            placeholder="행위자 · 내용 · 대상 ID 검색"
            className="h-11 w-full border border-hairline bg-white pl-4 pr-20 text-[14px] text-ink-deep placeholder:text-muted focus:border-ink-deep focus:outline-none"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3.5 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:text-ink-deep"
          >
            검색
          </button>
        </div>
      </form>

      <div className="rise rise-2">
        <Panel flush>
          {logs.length === 0 ? (
            <EmptyState>
              {q || group !== "ALL" ? "조건에 맞는 기록이 없습니다." : "아직 기록이 없습니다."}
            </EmptyState>
          ) : (
            <TableWrap minWidth={980}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>일시</Th>
                  <Th>행위자</Th>
                  <Th>동작</Th>
                  <Th>내용</Th>
                  <Th>대상</Th>
                  <Th align="right">IP</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => {
                  const href = targetLink(l.target, l.targetId);
                  return (
                    <tr
                      key={l.id}
                      className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                    >
                      <td className="whitespace-nowrap px-5 py-3 text-[12px] text-muted sm:px-6">
                        {dateFmt(l.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-[13px] sm:px-6">
                        <span className="font-semibold text-ink-deep">{l.actorName}</span>
                        {l.actorRole && l.actorRole !== "ADMIN" && (
                          <span className="ml-1.5 text-[11px] text-muted">{l.actorRole}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 sm:px-6">
                        <StatusPill
                          tone={
                            isCritical(l.action)
                              ? "bg-ink-deep text-white"
                              : "bg-hairline-soft text-ink-soft"
                          }
                        >
                          {auditLabel(l.action)}
                        </StatusPill>
                      </td>
                      <td className="max-w-[340px] px-5 py-3 text-[13px] text-ink-soft sm:px-6">
                        {l.summary || "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-[12px] sm:px-6">
                        {href ? (
                          <Link
                            href={href}
                            className="font-display tracking-[0.04em] text-ink-deep underline underline-offset-4"
                          >
                            {l.targetId.slice(0, 8).toUpperCase()}
                          </Link>
                        ) : (
                          <span className="text-muted">{l.targetId || "—"}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-[12px] text-muted sm:px-6">
                        {l.ip || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>

      {lastPage > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4 text-[13px]">
          {page > 1 ? (
            <Link href={`/admin/audit${qs({ page: page - 1 })}`} className="text-ink-soft hover:text-ink-deep">
              ← 이전
            </Link>
          ) : (
            <span className="text-muted/50">← 이전</span>
          )}
          <span className="text-muted">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={`/admin/audit${qs({ page: page + 1 })}`} className="text-ink-soft hover:text-ink-deep">
              다음 →
            </Link>
          ) : (
            <span className="text-muted/50">다음 →</span>
          )}
        </div>
      )}

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        기록은 화면에서 수정·삭제할 수 없습니다. 발급된 임시 비밀번호 같은 민감값은 기록에 남기지 않습니다.
      </p>
    </div>
  );
}
