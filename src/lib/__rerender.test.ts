import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("rerender", () => {
  it("prod", async () => {
    const { db } = await import("./db");
    const { readPublicUpload, saveImageBuffer, deleteUploadIfUnused } = await import("./storage");
    const { renderTranslatedImage, parseOcrBoxes } = await import("./imageTranslate");
    const path = await import("node:path");

    const rows = await db.productAsset.findMany({
      where: { originalUrl: { not: null }, ocrData: { not: null } },
      select: { id: true, url: true, originalUrl: true, ocrData: true, productId: true },
      orderBy: { id: "asc" },
    });
    // 새 사다리로 이미 다시 뽑은 장은 건너뛴다 (연결 끊김 뒤 이어하기).
    // 파일 생성 시각이 이번 실행 시작 이후면 완료된 것.
    const targets = rows;
    console.log(`대상 ${targets.length}장 (잘림 검수 포함 전체 재렌더)`);

    let done = 0;
    let failed = 0;
    const CONC = 3;
    for (let i = 0; i < targets.length; i += CONC) {
      await Promise.all(
        targets.slice(i, i + CONC).map(async (r, k) => {
          const n = i + k + 1;
          try {
            const file = await readPublicUpload(path.basename(r.originalUrl!));
            if (!file) throw new Error("원본 없음");
            const boxes = parseOcrBoxes(JSON.parse(r.ocrData!));
            if (boxes.length === 0) throw new Error("문구 없음");
            const out = await renderTranslatedImage(file.data, file.contentType, boxes);
            const saved = await saveImageBuffer(out.data, out.mime, 15 * 1024 * 1024);
            if (!saved.ok) throw new Error(saved.error);
            const old = r.url;
            await db.productAsset.update({
              where: { id: r.id },
              data: { url: saved.url, bytes: out.data.byteLength },
            });
            await db.product.updateMany({
              where: { id: r.productId, image: old },
              data: { image: saved.url },
            });
            if (old !== r.originalUrl) await deleteUploadIfUnused(old, { exceptAssetId: r.id });
            done++;
            console.log(`${n}/${targets.length} 완료`);
          } catch (e) {
            failed++;
            console.log(`${n}/${targets.length} 실패: ${e instanceof Error ? e.message : e}`);
          }
        }),
      );
    }
    console.log(`끝 — 성공 ${done} / 실패 ${failed}`);
  }, 7_200_000);
});
