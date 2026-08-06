import "server-only";
import { getCategories } from "@/lib/categories";
import type { ImportDraft } from "./types";

/**
 * 중국어 상품 정보 → 한국어 번역 + 카테고리 자동 분류 (Gemini API).
 *
 * GEMINI_API_KEY 가 없으면 번역을 건너뛰고 원문을 그대로 둔다.
 * (수집 자체는 성공시키고, 관리자가 어드민에서 직접 번역할 수 있게 한다)
 */

/**
 * 모델: 신규 발급 키는 구세대(2.5) 호출이 막혀 있다(404, 실키로 확인).
 * 3.6-flash 는 무료 등급에서도 동작 확인됨. thinking 은 이 작업(짧은 번역·분류)에
 * 불필요한 토큰만 태우므로 minimal 로 끈다.
 */
const MODEL = "gemini-3.6-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 60_000;

export interface Translation {
  name: string;
  description: string;
  categorySlug: string;
  /** AI를 실제로 호출했는지 — 어드민에 "번역 안 됨"을 알리기 위해 */
  translated: boolean;
  note?: string;
}

export function isTranslatorConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** 카테고리 슬러그가 실제 목록에 있는지 검증 (모델 환각 방지) */
function validCategory(slug: unknown, slugs: Set<string>): string | null {
  if (typeof slug !== "string") return null;
  return slugs.has(slug) ? slug : null;
}

function fallback(draft: ImportDraft, note: string): Translation {
  const attrs = draft.rawAttributes.map((a) => `${a.label}: ${a.value}`).join("\n");
  return {
    name: draft.rawTitle || `1688 상품 ${draft.sourceId}`,
    description: [
      "※ 자동 번역이 적용되지 않았습니다. 아래 원문을 검토해 한국어로 수정해주세요.",
      "",
      `[원문 상품명] ${draft.rawTitle}`,
      attrs ? `\n[원문 속성]\n${attrs}` : "",
      `\n[원본] ${draft.sourceUrl}`,
    ]
      .filter(Boolean)
      .join("\n"),
    categorySlug: "",
    translated: false,
    note,
  };
}

const SYSTEM = `당신은 한국 성인용품 B2B 도매몰의 상품 등록 담당자입니다.
중국 1688 상품 정보를 한국 도매몰용으로 다듬습니다.

규칙:
- 상품명: 한국 도매몰에서 쓰기 자연스럽게. 40자 이내. 과장·의학적 효능 표현 금지.
- 직역투·어색한 음차 금지. 한국 쇼핑몰에서 실제로 쓰는 명칭으로 옮깁니다
  (예: 袜子→양말, 情趣内衣→섹시 란제리, 套装→세트). 확신이 없는 단어는
  억지로 옮기지 말고 품목이 드러나는 일반 명칭을 씁니다.
- 설명: 마크다운 없이 평문. 상품 소개 2~3문장 + 소재/구성/사이즈 등 스펙을 줄바꿈으로 정리.
- 원문에 없는 정보를 지어내지 마세요. 모르는 항목은 생략합니다.
- categorySlug 는 주어진 목록에서만 선택합니다. 애매하면 가장 가까운 것을 고르세요.
- 반드시 JSON 객체만 출력합니다. 코드펜스·설명 금지.`;

export async function translateDraft(draft: ImportDraft): Promise<Translation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback(draft, "GEMINI_API_KEY 미설정");

  const categories = await getCategories();
  const catList = categories.map((c) => `${c.slug} = ${c.name}`).join("\n");
  const attrs = draft.rawAttributes.map((a) => `${a.label}: ${a.value}`).join("\n");

  const userMsg = `[카테고리 목록]
${catList}

[원문 상품명]
${draft.rawTitle}

[원문 속성]
${attrs || "(없음)"}

다음 형식의 JSON만 출력:
{"name":"한국어 상품명","description":"한국어 설명","categorySlug":"위 목록의 slug"}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        // 키는 URL 쿼리가 아니라 헤더로 — 로그·프록시에 키가 남지 않게
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        generationConfig: {
          maxOutputTokens: 2000,
          // JSON 강제 — 코드펜스·잡담 없이 객체만 받는다
          responseMimeType: "application/json",
          // thinking 토큰이 maxOutputTokens 를 갉아먹어 JSON 이 잘리는 것 방지
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fallback(draft, `번역 API 오류 ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    // 모델이 코드펜스를 붙이는 경우를 대비해 JSON 본문만 추출
    const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (!m) return fallback(draft, "번역 응답을 해석할 수 없음");

    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const name = String(parsed.name ?? "").trim();
    const description = String(parsed.description ?? "").trim();
    if (!name) return fallback(draft, "번역 결과에 상품명이 없음");

    return {
      name: name.slice(0, 120),
      description:
        `${description}\n\n[원본] ${draft.sourceUrl}`.trim().slice(0, 4000),
      categorySlug: validCategory(parsed.categorySlug, new Set(categories.map((c) => c.slug))) ?? "",
      translated: true,
    };
  } catch (e) {
    const msg = ctrl.signal.aborted ? "번역 시간 초과" : e instanceof Error ? e.message : String(e);
    return fallback(draft, msg);
  } finally {
    clearTimeout(timer);
  }
}
