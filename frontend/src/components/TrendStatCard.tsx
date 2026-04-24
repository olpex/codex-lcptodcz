import clsx from "clsx";
import { KpiSparkline } from "./KpiSparkline";

type TrendStatCardProps = {
  title: string;
  valueLabel: string;
  delta: number | null;
  deltaSuffix?: string;
  series: number[];
  sparklineLabel: string;
  className?: string;
};

function formatDelta(delta: number | null, suffix = ""): string {
  if (delta == null) return "Немає динаміки";
  if (delta === 0) return "Без змін";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}${suffix}`;
}

export function TrendStatCard({
  title,
  valueLabel,
  delta,
  deltaSuffix = "",
  series,
  sparklineLabel,
  className
}: TrendStatCardProps) {
  return (
    <article className={clsx("rounded-xl border border-slate-200 bg-white p-3", className)}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <p className="text-2xl font-heading font-bold text-pine">{valueLabel}</p>
        <span
          className={clsx(
            "rounded-full px-2 py-1 text-xs font-semibold",
            delta == null || delta === 0
              ? "bg-slate-100 text-slate-600"
              : delta > 0
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
          )}
        >
          {formatDelta(delta, deltaSuffix)}
        </span>
      </div>
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
        <KpiSparkline values={series} label={sparklineLabel} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Останні {Math.max(1, series.length)} оновлень</p>
    </article>
  );
}
