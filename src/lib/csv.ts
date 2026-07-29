/**
 * 엑셀에서 바로 열리는 CSV 를 만든다.
 *
 * - 셀에 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다 (RFC 4180)
 * - 맨 앞에 BOM 을 붙인다 — 없으면 엑셀이 한글을 EUC-KR 로 읽어 깨진다
 * - `=`, `+`, `-`, `@` 로 시작하는 셀은 앞에 ' 를 붙여 수식 주입을 막는다
 *   (회원이 입력한 수령인·메모가 그대로 들어가므로)
 */
// 반드시 이스케이프로 표기 — 보이지 않는 문자를 리터럴로 넣으면 에디터/포매터가 지워도 모른다
export const CSV_BOM = "\uFEFF";

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
