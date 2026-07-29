import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { updateFaq } from "@/lib/actions/admin-faqs";
import { FaqForm } from "@/components/admin/FaqForm";
import { PageHeader, Panel } from "@/components/ui/Panel";

export default async function EditFaqPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const faq = await db.faq.findUnique({ where: { id } });
  if (!faq) notFound();

  return (
    <div>
      <PageHeader eyebrow="Catalog" title="FAQ 수정" description={faq.question} />
      <Panel>
        <FaqForm action={updateFaq.bind(null, id)} faq={faq} />
      </Panel>
    </div>
  );
}
