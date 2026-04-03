export function AdminTopbar() {
  return (
    <header className="flex items-center justify-between h-14 px-8 border-b border-[#E3E8EF] bg-white">
      <h2 className="text-sm font-medium text-[#697386]">
        Administration
      </h2>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0A2540] bg-[#F6F9FC] px-2.5 py-1 rounded-md border border-[#E3E8EF]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#09825D]" />
          ADMIN
        </span>
      </div>
    </header>
  );
}
