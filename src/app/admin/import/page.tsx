import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { dateFmt } from "@/lib/format";
import { bookmarkletHref } from "@/lib/import/bookmarklet";
import { isTranslatorConfigured } from "@/lib/import/translate";
import { ImportForm } from "@/components/admin/ImportForm";
import { BookmarkletLink } from "@/components/admin/BookmarkletLink";
import { clearImportJobs, deleteImportJob } from "@/lib/actions/admin-import";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
} from "@/components/ui/Panel";

const steps = [
  "아래 [1688 수집] 버튼을 브라우저 북마크바로 드래그해 등록합니다. (최초 1회)",
  "1688에 로그인한 뒤 가져올 상품의 상세페이지를 엽니다.",
  "상세 이미지가 모두 뜨도록 페이지를 끝까지 스크롤합니다. (지연 로딩 때문에 필수)",
  "북마크바의 [1688 수집]을 클릭하면 데이터가 클립보드에 복사됩니다.",
  "이 화면 아래 입력창에 붙여넣고 [수집 실행]을 누릅니다.",
];

export default async function AdminImportPage() {
  await requireAdmin();

  const jobs = await db.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const aiReady = isTranslatorConfigured();

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="1688 상품 수집"
        description="1688 상세페이지의 상품 정보·이미지·GIF를 가져와 상품 초안을 만듭니다."
      />

      {!aiReady && (
        <div className="rise mb-4 border border-brand-500 bg-brand-50 px-5 py-4 text-[13px]">
          <p className="font-bold text-brand-700">AI 번역이 꺼져 있습니다</p>
          <p className="mt-1.5 text-ink-soft">
            환경변수 <code className="bg-white px-1">GEMINI_API_KEY</code> 를 설정하면 상품명·설명
            중→한 번역과 카테고리 자동 분류가 동작합니다. 지금은 수집은 되지만 원문(중국어)이 그대로
            들어갑니다.
          </p>
        </div>
      )}

      <div className="rise rise-1 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <ImportForm />
        </div>

        <div className="space-y-4">
          <Panel title="사용 방법">
            <div className="mb-4">
              <BookmarkletLink href={bookmarkletHref()} label="⬇ 1688 수집" />
            </div>
            <p className="mb-4 text-[12px] text-muted">
              ↑ 이 버튼을 <strong className="text-ink-deep">북마크바로 드래그</strong>하세요. (클릭이
              아니라 드래그입니다)
            </p>
            <ol className="space-y-2.5 text-[13px] leading-relaxed text-ink-soft">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-2.5">
                  <span className="font-display shrink-0 font-bold text-ink-deep">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="동작 방식">
            <ul className="space-y-2 text-[12px] leading-relaxed text-muted">
              <li>
                1688은 서버에서 직접 페이지를 읽으면 봇으로 차단합니다. 그래서 대표님이 로그인한
                브라우저에서 데이터를 뽑아 넘기는 방식입니다.
              </li>
              <li>이미지·GIF는 CDN에서 서버가 직접 내려받아 LUVY에 보관합니다.</li>
              <li>
                GIF는 원본(움직이는) 파일로 받도록 URL을 되돌려 처리합니다. 미리보기용 정적 이미지가
                아닙니다.
              </li>
              <li>수집된 상품은 항상 <strong className="text-ink-deep">숨김·0원</strong>으로 등록됩니다.</li>
            </ul>
          </Panel>
        </div>
      </div>

      <div className="rise rise-2 mt-8">
        <Panel
          title="수집 이력"
          flush
          action={
            jobs.some((j) => j.status !== "PENDING") ? (
              <form action={clearImportJobs}>
                <button
                  type="submit"
                  className="border border-hairline px-3.5 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:border-ink-deep hover:text-ink-deep"
                >
                  완료·실패 기록 비우기
                </button>
              </form>
            ) : undefined
          }
        >
          {jobs.length === 0 ? (
            <EmptyState>아직 수집 이력이 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={760}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>상품번호</Th>
                  <Th>상품명</Th>
                  <Th align="center">이미지</Th>
                  <Th align="center">상태</Th>
                  <Th align="right">일시</Th>
                  <Th align="right">기록</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                  >
                    <td className="whitespace-nowrap px-5 py-3.5 sm:px-6">
                      <a
                        href={j.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-display text-[13px] text-ink-deep underline underline-offset-4"
                      >
                        {j.sourceId}
                      </a>
                    </td>
                    <td className="px-5 py-3.5 sm:px-6">
                      {j.productId ? (
                        <Link
                          href={`/admin/products/${j.productId}`}
                          className="font-semibold text-ink-deep"
                        >
                          {j.koTitle || j.rawTitle || "(제목 없음)"}
                        </Link>
                      ) : (
                        <span className="text-ink-soft">{j.rawTitle || "(제목 없음)"}</span>
                      )}
                      {j.error && (
                        <span className="mt-0.5 block text-[12px] text-brand-600">{j.error}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center font-display text-[14px] text-ink-deep sm:px-6">
                      {j.imageCount}
                    </td>
                    <td className="px-5 py-3.5 text-center sm:px-6">
                      <StatusPill
                        tone={
                          j.status === "DONE"
                            ? "bg-ink-deep text-white"
                            : j.status === "FAILED"
                              ? "bg-brand-500 text-white"
                              : "bg-hairline-soft text-muted"
                        }
                      >
                        {j.status === "DONE" ? "완료" : j.status === "FAILED" ? "실패" : "진행중"}
                      </StatusPill>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right text-[13px] text-muted sm:px-6">
                      {dateFmt(j.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right sm:px-6">
                      {/* 기록만 지운다 — 등록된 상품은 그대로 남는다 */}
                      <form action={deleteImportJob}>
                        <input type="hidden" name="id" value={j.id} />
                        <button
                          type="submit"
                          aria-label="수집 기록 삭제"
                          className="text-[12.5px] text-muted transition-colors hover:text-ink-deep"
                        >
                          삭제
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
