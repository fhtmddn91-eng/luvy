/**
 * 관리자 계정 설정/갱신 스크립트 (환경변수 기반).
 *
 *   ADMIN_ID  = 로그인 아이디 (또는 이메일)
 *   ADMIN_PW  = 비밀번호
 *
 * 위 두 값이 있으면 해당 계정을 role=ADMIN / status=APPROVED 로 만든다.
 *
 * 계정이 이미 있으면 비밀번호는 **건드리지 않는다** — 어드민 설정 화면에서
 * 바꾼 비밀번호가 재배포 때마다 환경변수 값으로 되돌아가면 안 되기 때문이다.
 * 비밀번호를 잊어 환경변수 값으로 강제로 되돌리려면 ADMIN_PW_FORCE=1 을 추가한다.
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

  const force = process.env.ADMIN_PW_FORCE === "1";
  const existing = await db.user.findUnique({ where: { email: id }, select: { id: true } });

  if (existing) {
    // 권한·승인 상태는 항상 보정하되, 비밀번호는 강제 플래그가 있을 때만 덮어쓴다
    await db.user.update({
      where: { email: id },
      data: {
        role: "ADMIN",
        status: "APPROVED",
        ...(force ? { passwordHash: await bcrypt.hash(pw, 10) } : {}),
      },
    });
    console.log(
      `[set-admin] 기존 관리자 유지 — 아이디: ${id}${force ? " (비밀번호 강제 재설정됨)" : " (비밀번호 유지)"}`,
    );
    return;
  }

  await db.user.create({
    data: {
      email: id,
      passwordHash: await bcrypt.hash(pw, 10),
      companyName: "LUVY 운영팀",
      businessNumber: "0000000000",
      ownerName: "관리자",
      phone: "1600-0000",
      role: "ADMIN",
      status: "APPROVED",
    },
  });
  console.log(`[set-admin] 관리자 계정 생성 완료 — 아이디: ${id}`);
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
