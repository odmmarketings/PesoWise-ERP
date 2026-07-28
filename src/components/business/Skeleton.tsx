"use client"

// Mga pang-loading na placeholder. Ginagamit habang hinihila ang datos, para hindi
// blangko o "0" ang ipinapakita — malinaw na naglo-load pa, hindi walang laman.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200/80 ${className}`} />
}

/** Placeholder ng isang stat card (kaparehong taas ng totoong card). */
export function StatCardSkeleton({ height = "h-[78px]" }: { height?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-slate-200/70 animate-pulse ${height}`}>
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-end gap-2">
        <div className="h-6 w-16 rounded bg-slate-300/70" />
        <div className="h-2.5 w-24 rounded bg-slate-300/50" />
      </div>
    </div>
  )
}

/** Hanay ng mga placeholder na card. */
export function StatCardsSkeleton({ count = 6, height, className = "" }: {
  count?: number; height?: string; className?: string
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => <StatCardSkeleton key={i} height={height} />)}
    </div>
  )
}

/** Placeholder ng ilang row ng table. */
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className={`h-3 rounded bg-slate-200/80 animate-pulse ${c === 0 ? "w-40" : "flex-1"}`}
              style={{ animationDelay: `${(r * cols + c) * 25}ms` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Placeholder ng isang chart panel. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex items-end gap-2 px-2" style={{ height }}>
      {[60, 85, 45, 95, 70, 55, 80, 40].map((h, i) => (
        <div key={i} className="flex-1 rounded-t bg-slate-200/80 animate-pulse"
          style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  )
}
