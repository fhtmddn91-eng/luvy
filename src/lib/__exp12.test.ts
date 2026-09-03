/** 임시 실측 — 어드민 「다시 만들기」 전체 경로 + 승인 문구 기억 (승인된 실험 1장, 끝나면 삭제) */
import { it } from "vitest";
import fs from "node:fs";
import sharp from "sharp";
import { translateImageAuto, type OcrBox } from "./imageTranslate";
const DIR = "/private/tmp/claude-501/-Users-dooya8787-Desktop-luvy/b2e3b6b4-b299-4000-8ef9-995de0f08cbe/scratchpad/";
const OUT = "/private/tmp/claude-501/-Users-dooya8787-Desktop-luvy/e50b1faf-8c69-422a-8107-352f42684a11/scratchpad/";
it("M18 전체경로 exp12", { timeout: 1_800_000 }, async () => {
  process.env.GIF_BAND_DEBUG_DIR = OUT + "exp12_bands";
  const gif = fs.readFileSync(DIR + "1786353396506-086d40453d5a.gif");
  const approved = JSON.parse(fs.readFileSync(DIR + "ocrf_M18.json", "utf8")) as OcrBox[];
  const phraseMemory = new Map(approved.map((b) => [b.zh, b.ko]));
  const t0 = Date.now();
  const r = await translateImageAuto(gif, "image/gif", { safetyFallback: true, phraseMemory });
  console.log(`[실측12] ${Math.round((Date.now() - t0) / 1000)}초 · 판정 ${r.status}`);
  if ("reasons" in r && r.reasons) console.log(`  사유: ${JSON.stringify(r.reasons).slice(0, 1500)}`);
  if ("boxes" in r && r.boxes) console.log(`  문구: ${JSON.stringify(r.boxes.map((b) => `${b.zh}→${b.ko}`), null, 0)}`);
  if ("data" in r && r.data) {
    fs.writeFileSync(`${OUT}exp12_M18.gif`, r.data);
    fs.writeFileSync(`${OUT}exp12_M18.jpg`, await sharp(r.data, { page: 0, pages: 1 }).jpeg({ quality: 93 }).toBuffer());
    const m = await sharp(r.data, { animated: true }).metadata();
    console.log(`  결과 프레임 ${m.pages}`);
  }
});
