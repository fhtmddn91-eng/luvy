import { requireAdmin } from "@/lib/auth";
import { createFaq } from "@/lib/actions/admin-faqs";
import { FaqForm } from "@/components/admin/FaqForm";
import { PageHeader, Panel } from "@/components/ui/Panel";

export default async function NewFaqPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader eyebrow="Catalog" title="FAQ 등록" />
      <Panel>
        <FaqForm action={createFaq} />
      </Panel>
    </div>
  );
}
