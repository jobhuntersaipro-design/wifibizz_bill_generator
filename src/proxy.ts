import authConfig from "./auth.config";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export const proxy = auth(async (req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isAuthRoute = pathname.startsWith("/api/auth");
  const isSignInPage = pathname.startsWith("/auth/signin");

  // Allow auth API routes and sign-in page to pass through
  if (isAuthRoute || isSignInPage) {
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
  matcher: ["/", "/dashboard/:path*"],
};
