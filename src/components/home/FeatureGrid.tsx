import { Icon } from "@/components/ui/Icon";
import { features } from "@/lib/mock/features";

export function FeatureGrid() {
  return (
    <section className="bg-charcoal">
      <div className="mx-auto max-w-[1280px] px-6 py-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-5">
          {features.map((feature, i) => (
            <div key={feature.title} className="flex items-start gap-3">
              {i > 0 && (
                <span
                  className="hidden h-12 w-px self-center bg-white/10 lg:block"
                  aria-hidden
                />
              )}
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-brand-400 ring-1 ring-white/10">
                <Icon name={feature.icon} className="h-5 w-5" strokeWidth={1.7} />
              </span>
              <div className="leading-snug">
                <p className="text-[14px] font-bold text-white">{feature.title}</p>
                <p className="mt-1 text-[12px] text-white/55">{feature.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
