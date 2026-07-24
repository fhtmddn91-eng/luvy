/**
 * 관리자 계정 설정/갱신 스크립트 (환경변수 기반).
 *
 *   ADMIN_ID  = 로그인 아이디 (또는 이메일)
 *   ADMIN_PW  = 비밀번호
 *
 * 위 두 값이 있으면 해당 계정을 role=ADMIN / status=APPROVED 로 upsert 한다.
 * (이미 있으면 비밀번호·권한만 갱신, 없으면 생성)
 *
 * - 비밀번호는 bcrypt 해시로만 저장되며, 이 파일에 평문이 들어가지 않는다.
 * - Railway 배포 시작 명령에 포함되어, 값이 없으면 조용히 건너뛰고
 *   실패해도 부팅을 막지 않도록 항상 정상 종료(exit 0)한다.
 *
 * 로컬 실행 예:
 *   ADMIN_ID=luvyb2b ADMIN_PW='****' npm run set:admin
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const id = process.env.ADMIN_ID?.trim();
  const pw = process.env.ADMIN_PW;

  if (!id || !pw) {
    console.log("[set-admin] ADMIN_ID / ADMIN_PW 미설정 — 건너뜁니다.");
    return;
  }

  const passwordHash = await bcrypt.hash(pw, 10);

  const user = await db.user.upsert({
    where: { email: id },
    update: { passwordHash, role: "ADMIN", status: "APPROVED" },
    create: {
      email: id,
      passwordHash,
      companyName: "LUVY 운영팀",
      businessNumber: "0000000000",
      ownerName: "관리자",
      phone: "1600-0000",
      role: "ADMIN",
      status: "APPROVED",
    },
  });

  console.log(`[set-admin] 관리자 계정 설정 완료 — 아이디: ${user.email}`);
}

main()
  .catch((e) => {
    // 배포 부팅을 막지 않도록 오류는 기록만 하고 넘어간다.
    console.error("[set-admin] 실패(무시하고 계속):", e);
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
