export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6">
      <main className="flex flex-col items-center gap-6 text-center max-w-md">
        <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-600 text-white text-4xl font-bold shadow-lg">
          £
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          No Overtime
        </h1>

        <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Snap your receipts. Export HMRC-ready spreadsheets.
          <br />
          No fuss. No overtime.
        </p>

        <button
          type="button"
          className="mt-4 h-14 w-full max-w-xs rounded-xl bg-emerald-600 px-6 text-lg font-bold text-white shadow-md transition-transform active:scale-95"
        >
          Scan a Receipt
        </button>
      </main>
    </div>
  );
}
