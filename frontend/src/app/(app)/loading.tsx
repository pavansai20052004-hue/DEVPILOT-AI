export default function AppLoading() {
  return (
    <div className="grid gap-5">
      <div className="h-40 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {["one", "two", "three", "four"].map((item) => (
          <div
            key={item}
            className="h-36 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]"
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
    </div>
  );
}
