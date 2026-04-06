"use client";

import { useState } from "react";
import { adminLogin } from "@/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminLoginForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    try {
      const result = await adminLogin(username, password);
      if (result?.error) {
        setError(result.error);
      }
    } catch {
      // redirect throws on success
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F9FC]">
      <div className="w-full max-w-sm mx-auto p-6">
        <div className="bg-white rounded-lg border border-[#E3E8EF] p-8 animate-scale-in">
          <div className="mb-8 text-center">
            <div className="w-12 h-12 rounded-lg bg-[#0A2540] flex items-center justify-center mx-auto mb-4 animate-scale-in" style={{ animationDelay: "100ms" }}>
              <ShieldIcon className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-[#0A2540] animate-fade-in-up" style={{ animationDelay: "200ms" }}>Admin Access</h1>
            <p className="text-[#697386] mt-1 text-sm animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              BizzFlow administration panel
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in-up" style={{ animationDelay: "400ms" }}>
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-medium text-[#425466]">
                Username
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                placeholder="Admin username"
                required
                autoComplete="username"
                className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-[#425466]">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Admin password"
                required
                autoComplete="current-password"
                className="rounded-lg h-10 border-[#E3E8EF] focus:border-[#635BFF]"
              />
            </div>

            {error && (
              <div className="text-sm text-[#DF1B41] bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 rounded-lg text-sm font-semibold bg-[#0A2540] hover:bg-[#0A2540]/90 transition-colors duration-150 hover-glow press-effect"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Signing in...
                </span>
              ) : (
                "Sign in as Admin"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}
