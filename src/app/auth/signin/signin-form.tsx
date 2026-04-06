"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const result = await login(email, password, callbackUrl);

      if (result?.error) {
        setError(result.error);
        if (result.rateLimited) {
          toast.error(result.error);
        }
      }
    } catch {
      // NEXT_REDIRECT throws on successful sign-in — this is expected
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0A2540] relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-20 left-10 w-72 h-72 bg-[#635BFF]/15 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-[#635BFF]/10 rounded-full blur-3xl animate-float" style={{ animationDelay: "1.5s", animationDuration: "4s" }} />
          <div className="absolute top-1/2 left-1/3 w-48 h-48 bg-[#635BFF]/8 rounded-full blur-3xl animate-float" style={{ animationDelay: "0.8s", animationDuration: "5s" }} />
        </div>
        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="flex items-center gap-3 mb-10 animate-fade-in" style={{ animationDelay: "200ms" }}>
            <div className="w-10 h-10 bg-[#635BFF] rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
              </svg>
            </div>
            <span className="text-xl font-semibold tracking-tight">BizzFlow</span>
          </div>
          <h1 className="text-3xl font-semibold leading-tight mb-4 animate-fade-in-up" style={{ animationDelay: "400ms" }}>
            Manage your fibre cases
            <br />
            and generate bills.
          </h1>
          <p className="text-base text-white/50 max-w-md leading-relaxed animate-fade-in-up" style={{ animationDelay: "600ms" }}>
            Crawl activated cases, track customer data, and generate
            professional utility bills — all in one place.
          </p>
        </div>
      </div>

      {/* Right panel — sign in form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-10 animate-fade-in">
            <div className="w-9 h-9 bg-[#635BFF] rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight text-[#0A2540]">BizzFlow</span>
          </div>

          <div className="mb-8 animate-fade-in-up" style={{ animationDelay: "300ms" }}>
            <h2 className="text-2xl font-semibold text-[#0A2540]">Welcome back</h2>
            <p className="text-[#697386] mt-1.5 text-sm">
              Sign in to your account to continue
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in-up" style={{ animationDelay: "450ms" }}>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-[#425466]">
                Email Address
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-[#425466]">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                  className="rounded-lg h-10 pr-10 border-[#E3E8EF] focus:border-[#635BFF] focus:ring-1 focus:ring-[#635BFF]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#697386] hover:text-[#0A2540] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>
              {error && (
                <div className="text-sm text-[#DF1B41] bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                  {error}
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-10 rounded-lg text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] hover-glow"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-[#697386] animate-fade-in" style={{ animationDelay: "700ms" }}>
            Have trouble signing in?{" "}
            <a
              href="mailto:jobhunters.ai.pro@gmail.com"
              className="font-medium text-[#635BFF] hover:text-[#0A2540] transition-colors"
            >
              Contact Us
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
