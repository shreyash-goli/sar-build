export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="rounded-full border border-current px-3 py-1 text-xs font-semibold tracking-widest">
        DEMO DATA
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">FailSafe / Demo</h1>
      <p className="max-w-md text-sm opacity-80">
        Prototype starter screen. No data has been loaded and no external
        integrations are connected.
      </p>
    </main>
  );
}
