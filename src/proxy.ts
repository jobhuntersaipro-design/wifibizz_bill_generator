import authConfig from "./auth.config";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { getAdminCookie } from "@/lib/admin-auth";

const { auth } = NextAuth(authConfig);

export const proxy = auth(async (req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isAuthRoute = pathname.startsWith("/api/auth");
  const isSignInPage = pathname.startsWith("/auth/signin");

  // Admin routes — check admin cookie (separate from NextAuth)
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const cookieHeader = req.headers.get("cookie");
    const adminToken = getAdminCookie(cookieHeader);
    if (!adminToken) {
      return NextResponse.redirect(new URL("/admin/login", req.nextUrl));
    }
    return NextResponse.next();
  }

  // Allow admin login page, auth API routes, and sign-in page
  if (pathname.startsWith("/admin/login") || isAuthRoute || isSignInPage) {
    return NextResponse.next();
  }

  // Root route: redirect based on auth status
  if (pathname === "/") {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return NextResponse.redirect(new URL("/auth/signin", req.nextUrl));
  }

  // Redirect unauthenticated users away from dashboard
  if (pathname.startsWith("/dashboard") && !isLoggedIn) {
    return NextResponse.redirect(new URL("/auth/signin", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/", "/dashboard", "/dashboard/:path*", "/admin", "/admin/:path*"],
};
