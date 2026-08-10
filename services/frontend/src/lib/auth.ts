import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getSupabaseAdmin } from "./supabase";
import { hasActiveEntitlement } from "./billing";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        });

        if (error || !data.user) return null;

        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.display_name || null,
          image: data.user.user_metadata?.avatar_url || null,
        };
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      const supabase = getSupabaseAdmin();

      // Upsert user in our users table (use email as unique key, let DB generate UUID)
      const { error } = await supabase.from("users").upsert(
        {
          email: user.email,
          display_name: user.name || null,
          avatar_url: user.image || null,
          auth_provider: account?.provider === "google" ? "google" : "email",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      );

      if (error) {
        console.error("Error upserting user:", error);
        return false;
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }

      // Fetch plan from DB on every token refresh
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from("users")
        .select("plan, subscription_status, current_period_end, cancel_at_period_end")
        .eq("email", token.email!)
        .single();

      if (data) {
        const entitlementExpired = data.plan !== "free" && !hasActiveEntitlement({
          plan: data.plan,
          subscriptionStatus: data.subscription_status,
          currentPeriodEnd: data.current_period_end,
          cancelAtPeriodEnd: data.cancel_at_period_end,
        });
        token.plan = entitlementExpired ? "free" : data.plan;
        token.subscriptionStatus = entitlementExpired ? "canceled" : data.subscription_status;
      } else {
        token.plan = "free";
        token.subscriptionStatus = "inactive";
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        Object.assign(session.user, {
          id: token.userId,
          plan: token.plan,
          subscriptionStatus: token.subscriptionStatus,
        });
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },

  secret: process.env.NEXTAUTH_SECRET,
};
