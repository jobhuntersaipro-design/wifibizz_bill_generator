import authConfig from "./auth.config";
import NextAuth from "next-auth";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export const proxy = auth(async (req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isOnDashboard = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname.startsWith("/api/auth");

  // Allow auth API routes to pass through
  if (isAuthRoute) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users away from dashboard
  if (isOnDashboard && !isLoggedIn) {
    return NextResponse.redirect(new URL("/auth/signin", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
