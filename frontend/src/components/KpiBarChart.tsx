type KpiBarChartItem = {
  name: string;
  value: number;
};

type KpiBarChartProps = {
  items: KpiBarChartItem[];
};

export function KpiBarChart({ items }: KpiBarChartProps) {
  const maxValue = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const ratio = item.value <= 0 ? 0 : (item.value / maxValue) * 100;
        const widthPercent = ratio > 0 ? Math.max(4, ratio) : 0;
        return (
          <div key={item.name} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
            <span className="text-sm text-slate-700">{item.name}</span>
            <div className="h-4 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-pine transition-[width] duration-300 ease-out"
                style={{ width: `${widthPercent}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-ink">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
