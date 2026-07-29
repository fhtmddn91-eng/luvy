import { requireAdmin } from "@/lib/auth";
import { getShippingPolicy } from "@/lib/settings";
import { ShippingSettingsForm, AdminPasswordForm } from "@/components/admin/SettingsForms";
import { PageHeader, Panel } from "@/components/ui/Panel";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const policy = await getShippingPolicy();

  return (
    <div className="max-w-[560px]">
      <PageHeader eyebrow="System" title="설정" description="배송비 정책과 관리자 계정" />

      <div className="space-y-4">
        <div className="rise rise-1">
          <Panel title="배송비">
            <ShippingSettingsForm fee={policy.fee} freeThreshold={policy.freeThreshold} />
          </Panel>
        </div>

        <div className="rise rise-2">
          <Panel title="관리자 비밀번호">
            <AdminPasswordForm />
            <p className="mt-3 border-t border-hairline-soft pt-3 text-[12px] leading-relaxed text-muted">
              Railway 의 <code className="font-display">ADMIN_PW</code> 환경변수는 계정이
              없을 때 처음 만드는 용도로만 쓰입니다. 여기서 바꾼 비밀번호는 재배포해도
              유지됩니다. (비밀번호를 완전히 잊었을 때는{" "}
              <code className="font-display">ADMIN_PW_FORCE=1</code> 을 추가하고 재배포하면
              환경변수 값으로 다시 덮어씁니다)
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
