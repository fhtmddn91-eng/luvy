/**
 * 여러 줄 입력은 여러 줄로 보여야 한다 — 소스 수준 회귀 검사.
 *
 * 실사례(2026-09-08): 상품 설명만 `whitespace-pre-line` 이 빠져 있었다.
 * 공지·FAQ·문의·약관은 처음부터 붙어 있었는데 상품 설명만 카탈로그 첫 커밋
 * 이후 한 번도 손대지 않아, 관리자에서 줄을 나눠 써도 손님에겐 한 덩어리로
 * 붙어 보였다. 같은 점검에서 배송 메모 2곳도 같은 상태였다.
 *
 * 이건 CSS 클래스 하나라 단위 테스트로 값을 검증할 수가 없다. 그래서
 * **소스를 읽어** "여러 줄이 될 수 있는 필드를 그리는 자리에 pre-line 이
 * 있는가"를 검사한다(import/bookmarklet.test.ts 가 셀렉터를 검사하는 것과
 * 같은 방식). 새 화면이 규칙을 빠뜨리면 여기서 깨진다.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** textarea 로 입력받는 = 줄바꿈이 들어올 수 있는 필드 (schema.prisma 기준) */
const MULTILINE_FIELDS = ["memo", "description", "content", "body", "answer", "subtitle"] as const;

/**
 * 검사에서 빼는 자리와 그 이유.
 * 빼는 이유가 없는 예외는 만들지 않는다 — 예외가 늘면 검사가 무의미해진다.
 *
 * (JSX 속성으로 넘기는 값 `attr={x.answer}` 은 화면에 그리는 게 아니라
 *  자식 컴포넌트로 넘기는 것이라 아래 isAttribute 로 따로 걸러낸다.)
 */
const ALLOW = [
  // 목록에서는 일부러 한 줄로 접는다 (줄바꿈을 공백으로 바꿔 요약)
  'replace(/\\n/g, " ")',
  // 타입 선언·주석
  "?:",
  "interface",
  "* ",
  "//",
] as const;

/**
 * `defaultAnswer={inquiry.answer}` 처럼 **속성으로 넘기는** 자리인가.
 * 여는 중괄호 바로 앞이 `=` 면 속성이다 — 그 값은 받는 쪽(대개 textarea)이 그린다.
 * 이름을 하나씩 예외로 적으면(defaultValue·defaultAnswer…) 새 prop 이름마다 빠진다.
 */
function isAttribute(text: string, matchIndex: number): boolean {
  return text[matchIndex - 1] === "=";
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** `{something.memo}` 처럼 화면에 그대로 그리는 자리 */
const RENDER = new RegExp(`\\{[a-zA-Z_$][\\w$.?\\[\\]]*\\.(${MULTILINE_FIELDS.join("|")})\\b[^}]*\\}`);

interface Site {
  file: string;
  line: number;
  text: string;
}

function renderSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walk("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      const m = RENDER.exec(text);
      if (!m) return;
      if (isAttribute(text, m.index)) return;
      if (ALLOW.some((a) => text.includes(a))) return;
      sites.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return sites;
}

/** 그 자리(또는 감싸는 요소 3줄 안)에 pre-line 이 걸려 있는가 */
function hasPreLine(site: Site): boolean {
  const lines = readFileSync(site.file, "utf8").split("\n");
  const from = Math.max(0, site.line - 4);
  return lines.slice(from, site.line).some((l) => l.includes("whitespace-pre-line"));
}

describe("여러 줄 필드는 줄바꿈을 살려 보여준다", () => {
  it("검사 대상 자리를 실제로 찾아낸다 (정규식이 헛돌면 통과해버린다)", () => {
    // 이 검사 자체가 아무것도 안 찾으면 아래 검사는 항상 통과한다 — 그게 더 위험하다
    expect(renderSites().length).toBeGreaterThan(3);
  });

  it("모든 자리에 whitespace-pre-line 이 걸려 있다", () => {
    const missing = renderSites()
      .filter((s) => !hasPreLine(s))
      .map((s) => `${s.file}:${s.line}  ${s.text.slice(0, 90)}`);
    expect(missing).toEqual([]);
  });

  /** 검사가 진짜로 작동하는지 — 빠진 자리를 만들어 걸리는지 확인한다 */
  it("pre-line 이 없으면 걸러낸다 (검사가 헛돌지 않는지 확인)", () => {
    const 가짜 = { file: "src/lib/lineBreaks.test.ts", line: 1, text: "<dd>{order.memo}</dd>" };
    expect(hasPreLine(가짜)).toBe(false);
  });
});
