export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-2 text-[26px] font-extrabold text-ink">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}
