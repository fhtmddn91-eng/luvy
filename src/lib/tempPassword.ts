import { randomInt } from "node:crypto";

/**
 * 임시 비밀번호 생성.
 *
 * 전화로 불러주거나 카톡으로 보내줄 값이라 헷갈리는 글자(0/O, 1/l/I)는 뺀다.
 * 소문자·대문자·숫자가 반드시 하나씩 섞이도록 해 흔한 비밀번호 정책도 통과한다.
 */
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const ALL = LOWER + UPPER + DIGIT;

export const TEMP_PASSWORD_LENGTH = 10;

export function generateTempPassword(
  length: number = TEMP_PASSWORD_LENGTH,
  rng: (max: number) => number = randomInt,
): string {
  const len = Math.max(8, length);
  const chars: string[] = [
    LOWER[rng(LOWER.length)],
    UPPER[rng(UPPER.length)],
    DIGIT[rng(DIGIT.length)],
  ];
  while (chars.length < len) chars.push(ALL[rng(ALL.length)]);
  // 앞 3자리가 항상 소/대/숫자 순이 되지 않도록 섞는다 (Fisher–Yates)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
