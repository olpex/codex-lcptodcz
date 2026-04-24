type KpiSparklineProps = {
  values: number[];
  label: string;
  className?: string;
};

const CHART_WIDTH = 140;
const CHART_HEIGHT = 40;
const PADDING = 3;

export function KpiSparkline({ values, label, className }: KpiSparklineProps) {
  const safeValues = values.length ? values : [0];
  const minValue = Math.min(...safeValues);
  const maxValue = Math.max(...safeValues);
  const range = Math.max(1, maxValue - minValue);
  const count = safeValues.length;

  const points = safeValues.map((value, index) => {
    const x = PADDING + (index * (CHART_WIDTH - PADDING * 2)) / Math.max(1, count - 1);
    const normalized = (value - minValue) / range;
    const y = CHART_HEIGHT - PADDING - normalized * (CHART_HEIGHT - PADDING * 2);
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${(CHART_WIDTH - PADDING).toFixed(2)} ${(CHART_HEIGHT - PADDING).toFixed(2)} L ${PADDING.toFixed(2)} ${(CHART_HEIGHT - PADDING).toFixed(2)} Z`;
  const lastPoint = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className={className || "h-10 w-full text-pine"}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill="currentColor" opacity="0.12" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <circle cx={lastPoint.x} cy={lastPoint.y} r={2.8} fill="currentColor" />
    </svg>
  );
}
