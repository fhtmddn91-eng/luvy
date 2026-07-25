import { Logo } from "@/components/layout/Logo";
import { Icon } from "@/components/ui/Icon";

interface AuthCardProps {
  title: string;
  /** 폐쇄몰 안내 문구 (자물쇠 아이콘 아래 표시) */
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="w-full max-w-[440px]">
      <div className="mb-7 text-center">
        {/* 폐쇄몰이라 "/" 는 다시 로그인으로 리다이렉트되므로 로고에 링크를 걸지 않는다 */}
        <div className="mb-6 flex justify-center">
          <Logo href={null} />
        </div>
        <h1 className="text-[24px] font-extrabold text-ink">{title}</h1>

        <div className="mt-4 flex flex-col items-center">
          <Icon name="lock" className="h-5 w-5 text-brand-400" strokeWidth={1.8} />
          <p className="mt-1.5 text-[14px] font-bold text-ink">회원 전용 도매몰</p>
          <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-muted">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)] sm:p-7">
        {children}
      </div>

      <div className="mt-6 text-center text-[14px] text-muted">{footer}</div>
    </div>
  );
}
