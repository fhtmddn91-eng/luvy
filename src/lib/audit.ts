import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type { AuditAction } from "@/lib/auditActions";

/**
 * 감사 로그 기록.
 *
 * 원칙: **로그 실패가 본 기능을 막지 않는다.**
 * 승인·환불 같은 동작 뒤에 기록을 남기는데, 기록이 실패했다고 승인이 롤백되면
 * 운영자는 "왜 승인이 안 되지?"만 겪는다. 그래서 여기서 나는 예외는 삼키고
 * 서버 로그로만 남긴다. (반대로 로그가 비면 안 되는 규제 환경이라면 이 정책을 바꿔야 한다)
 *
 * 트랜잭션에 넣지 않는 이유도 같다 — 롤백되면 "시도했다"는 사실까지 사라진다.
 */
export interface AuditInput {
  action: AuditAction;
  target?: string;
  targetId?: string;
  summary?: string;
  meta?: Record<string, unknown>;
  /** 행위자를 직접 지정 (세션이 없는 웹훅 등). 없으면 현재 세션에서 가져온다 */
  actor?: { id: string | null; name: string; role: string };
}

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return h.get("x-real-ip") ?? "";
  } catch {
    return "";
  }
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    let actor = input.actor;
    if (!actor) {
      const user = await getSession();
      actor = user
        ? { id: user.id, name: user.companyName || user.email, role: user.role }
        : { id: null, name: "시스템", role: "SYSTEM" };
    }

    await db.auditLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.name.slice(0, 120),
        actorRole: actor.role,
        action: input.action,
        target: input.target ?? "",
        targetId: input.targetId ?? "",
        summary: (input.summary ?? "").slice(0, 300),
        // 민감값(비밀번호 등)은 애초에 넘기지 않는다 — 여기서 필터링하지 않는다
        meta: input.meta ? JSON.stringify(input.meta).slice(0, 2000) : "",
        ip: await clientIp(),
      },
    });
  } catch (e) {
    console.error("[audit] 기록 실패:", input.action, e);
  }
}

/** 주문번호 표기를 화면과 맞춘다 (앞 8자 대문자) */
export const shortId = (id: string): string => id.slice(0, 8).toUpperCase();
