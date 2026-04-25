import clsx from "clsx";

type StickyActionBarProps = {
  children: React.ReactNode;
  className?: string;
};

export function StickyActionBar({ children, className }: StickyActionBarProps) {
  return (
    <div
      className={clsx(
        "sticky top-2 z-20 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85",
        className
      )}
    >
      {children}
    </div>
  );
}
