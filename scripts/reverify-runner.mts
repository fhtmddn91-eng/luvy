/**
 * 저장 후보 재검증 러너 (수동 실행 도구 — 승인 시에만 돌린다).
 *
 * 규칙:
 *  · 검증 로직을 **복제하지 않는다** — reverifySavedCandidate(운영 함수)만 부른다.
 *  · 해시 표(원본·후보·pipelineVersion·문구 trace)가 맞아야 실행된다.
 *  · 모든 호출의 단계별 trace 를 신규 폴더에 남긴다 — 프롬프트 머리말·응답 본문·
 *    usage·status·quota metric·Retry-After. **인증 헤더와 키는 기록하지 않는다**
 *    (요청 헤더 객체 자체를 건드리지 않는다).
 *
 * 사용: OUT=<신규폴더> SRC=<live11폴더> NS=<02,04,06,08> npx tsx scripts/reverify-runner.mts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { reverifySavedCandidate, makeReverifyTicket } from "../src/lib/translateReverify.js";

const SRC = process.env.SRC ?? "";
const OUT = process.env.OUT ?? "";
const NS = (process.env.NS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!SRC || !OUT || NS.length === 0) throw new Error("SRC·OUT·NS 필요");
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length > 0) throw new Error("OUT 은 비어 있는 신규 폴더여야 한다");
fs.mkdirSync(OUT, { recursive: true });

interface Step {
  seq: number;
  kind: "text" | "image";
  promptHead: string;
  status: number;
  /** 오류 응답의 구조화 정보 — 429 가 분당인지 일간인지 알기 위해 반드시 남긴다 */
  error?: { status?: string; message?: string; retryAfter?: string | null };
  responseText: string | null;
  usage: unknown;
  ms: number;
}

const real = globalThis.fetch;
let steps: Step[] = [];
let seq = 0;
let imageCalls = 0;

globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const isImage = String(url).includes(process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image");
  if (isImage) imageCalls++;
  const body = JSON.parse(String(init?.body ?? "{}")) as { contents?: { parts?: { text?: string }[] }[] };
  const promptHead = (body.contents?.[0]?.parts?.map((p) => p.text ?? "").join(" ") ?? "").replace(/\s+/g, " ").slice(0, 80);
  const t0 = Date.now();
  const res = await real(url, init);
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 비 JSON 은 그대로 둔다 */
  }
  const step: Step = {
    seq: ++seq,
    kind: isImage ? "image" : "text",
    promptHead,
    status: res.status,
    responseText: null,
    usage: (parsed as { usageMetadata?: unknown })?.usageMetadata ?? null,
    ms: Date.now() - t0,
  };
  if (!res.ok) {
    const e = (parsed as { error?: { status?: string; message?: string } })?.error;
    step.error = { status: e?.status, message: e?.message?.slice(0, 300), retryAfter: res.headers?.get?.("retry-after") ?? null };
  }
  const parts =
    (parsed as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  // 이미지 응답의 base64 는 남기지 않는다(용량) — 텍스트 판정문만 원문 그대로
  if (!isImage) step.responseText = parts.map((p) => p.text ?? "").join("").slice(0, 6000) || null;
  return { ok: res.ok, status: res.status, headers: res.headers, json: async () => parsed } as unknown as Response;
}) as typeof fetch;

const results: unknown[] = [];
try {
  for (const n of NS) {
    steps = [];
    seq = 0;
    imageCalls = 0;
    const rec = (JSON.parse(fs.readFileSync(path.join(SRC, "results.json"), "utf8")) as { n: string; boxes: unknown }[]).find(
      (r) => r.n === n,
    );
    if (!rec?.boxes) throw new Error(`#${n} 판독 기록 없음`);
    const original = fs.readFileSync(path.join(SRC, `${n}-orig.jpg`));
    const modelPath = path.join(SRC, `${n}-model.png`);
    let candidate: { data: Buffer; mime: string } | undefined;
    if (fs.existsSync(modelPath)) {
      const m = await sharp(original).metadata();
      // 파이프라인의 callImageEdit 과 같은 방식으로 원본 크기에 맞춘다
      const data = await sharp(fs.readFileSync(modelPath)).resize(m.width, m.height, { fit: "fill" }).jpeg({ quality: 95 }).toBuffer();
      candidate = { data, mime: "image/jpeg" };
      fs.writeFileSync(path.join(OUT, `${n}-candidate.jpg`), data);
    }
    const boxes = rec.boxes as Parameters<typeof makeReverifyTicket>[0]["boxes"];
    const ticket = makeReverifyTicket({ original, candidate: candidate?.data ?? null, boxes });

    const t0 = Date.now();
    const outcome = await reverifySavedCandidate({ ticket, original, originalMime: "image/jpeg", boxes, candidate });
    const ms = Date.now() - t0;

    if ("data" in outcome && outcome.data) fs.writeFileSync(path.join(OUT, `${n}-final.jpg`), outcome.data);
    const summary = {
      n,
      status: outcome.status,
      reasons: "reasons" in outcome ? outcome.reasons : null,
      ticket,
      imageCalls,
      textCalls: steps.filter((s) => s.kind === "text").length,
      ms,
      steps, // 단계별 trace — 프롬프트 머리말·응답 본문·usage·오류 상세
    };
    results.push(summary);
    fs.writeFileSync(path.join(OUT, `${n}-trace.json`), JSON.stringify(summary, null, 1));
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
    process.stderr.write(`[${n}] ${outcome.status} img=${imageCalls} txt=${summary.textCalls} (${(ms / 1000).toFixed(0)}s)\n`);
    // 한도에 걸리면 즉시 중단 — 다음 장에 요청을 낭비하지 않는다
    if (steps.some((s) => s.status === 429)) {
      process.stderr.write("429 감지 — 즉시 중단\n");
      break;
    }
  }
} finally {
  globalThis.fetch = real;
}
