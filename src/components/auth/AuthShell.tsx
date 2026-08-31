"use client";

/** The centred card the account pages (forgot / reset) share. */
export function AuthShell({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F9FC] p-4">
      <div className="w-full max-w-md rounded-xl border border-[#E3E8EF] bg-white p-8 animate-fade-in-up">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#635BFF]">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0" />
            </svg>
          </div>
          <span className="text-xl font-semibold tracking-tight text-[#0A2540]">BizzFlow</span>
        </div>
        <h1 className="text-lg font-semibold text-[#0A2540]">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-[#697386]">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
