import clsx from "clsx";

type PanelProps = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

export function Panel({ title, children, className }: PanelProps) {
  return (
    <section className={clsx("rounded-2xl bg-white p-5 shadow-card", className)}>
      <h2 className="mb-4 font-heading text-xl font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

