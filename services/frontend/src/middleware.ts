import { withAuth } from "next-auth/middleware";

// Middleware only checks if user is logged in.
// Plan-based access control is handled by the Paywall component
// which fetches real-time plan from DB (avoids JWT cache issues).
export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
});

export const config = {
  matcher: ["/accumulation", "/fusion", "/account"],
};
