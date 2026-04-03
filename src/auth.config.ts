import type { NextAuthConfig } from "next-auth";

export default {
  pages: {
    signIn: "/auth/signin",
  },
  providers: [],
} satisfies NextAuthConfig;
