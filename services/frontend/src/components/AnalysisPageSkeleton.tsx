export function AnalysisPageSkeleton() {
  return (
    <div
      className="mx-auto max-w-7xl animate-pulse px-4 py-8"
      aria-busy="true"
      aria-label="Loading analysis"
    >
      <div className="h-8 w-56 rounded bg-gray-200" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-gray-100" />
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="h-32 rounded-xl border bg-gray-50" />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
