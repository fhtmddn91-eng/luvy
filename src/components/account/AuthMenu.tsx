import Link from "next/link";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";

export async function AuthMenu() {
  const user = await getSession();

  if (!user) {
    return (
      <>
        <Link href="/login" className="text-brand-700/80 transition-colors hover:text-brand-700">
          로그인
        </Link>
        <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
        <Link href="/signup" className="text-brand-700/80 transition-colors hover:text-brand-700">
          회원가입
        </Link>
      </>
    );
  }

  return (
    <>
      <span className="font-semibold text-brand-700">{user.companyName}님</span>
      <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
      <Link href="/orders" className="text-brand-700/80 transition-colors hover:text-brand-700">
        주문내역
      </Link>
      <span className="mx-3 h-2.5 w-px bg-brand-300/70" aria-hidden />
      <form action={logoutAction}>
        <button type="submit" className="text-brand-700/80 transition-colors hover:text-brand-700">
          로그아웃
        </button>
      </form>
    </>
  );
}
