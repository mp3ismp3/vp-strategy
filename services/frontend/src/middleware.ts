import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Plan-based access control
    const plan = (token?.plan as string) || "free";
    const subscriptionStatus = (token?.subscriptionStatus as string) || "inactive";

    const isActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";

    // Pro+ pages
    if (["/scanner", "/accumulation"].includes(path)) {
      if (!isActive && plan === "free") {
        return NextResponse.redirect(new URL("/pricing", req.url));
      }
    }

    // Premium pages
    if (path === "/fusion") {
      if (plan !== "premium" || !isActive) {
        return NextResponse.redirect(new URL("/pricing", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/scanner", "/accumulation", "/fusion", "/account"],
};
