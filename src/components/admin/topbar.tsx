export function AdminTopbar() {
  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-border bg-background">
      <h2 className="text-sm font-medium text-muted-foreground">
        Administration
      </h2>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded">
          ADMIN
        </span>
      </div>
    </header>
  );
}
