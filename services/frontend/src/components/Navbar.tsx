"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import type { Plan } from "@/types/user";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface NavbarUser {
  email?: string | null;
  image?: string | null;
  name?: string | null;
  plan?: Plan;
}

export function Navbar() {
  const { data: session } = useSession();
  const user = session?.user as NavbarUser | undefined;
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { href: "/dashboard", label: "Watchlist" },
    { href: "/scanner", label: "Scanner" },
    { href: "/accumulation", label: "Accumulation" },
  ];
  const analysisLinks = [
    { href: "/strategy", label: "Strategy" },
    { href: "/indicator", label: "Indicator" },
    { href: "/crypto-liquidity", label: "Crypto Liquidity" },
    { href: "/fusion", label: "Fusion" },
  ];

  return (
    <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/ptrade.svg"
              alt="P Trade"
              width={32}
              height={32}
              className="rounded-md"
            />
            <span className="font-bold text-lg">VP Strategy</span>
          </Link>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                {link.label}
              </Link>
            ))}
            <div className="group relative">
              <button
                type="button"
                aria-haspopup="menu"
                className="text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                Analysis Tools <span aria-hidden="true">▾</span>
              </button>
              <div className="absolute right-0 top-full z-50 hidden min-w-48 pt-2 group-hover:block group-focus-within:block">
                <div role="menu" className="rounded-lg border bg-white p-1 shadow-md">
                  {analysisLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      role="menuitem"
                      className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
            <Link href="/pricing" className="text-sm font-medium text-gray-700 hover:text-gray-900">Pricing</Link>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {/* User Menu (desktop + mobile) */}
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize hidden sm:inline-flex">
                    {user?.plan || "free"}
                  </Badge>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={user?.image || ""} />
                    <AvatarFallback>
                      {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-sm text-gray-500">
                    {user?.email}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Link href="/account">Account</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/pricing">Pricing</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut()}>
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href="/login"
                className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800"
              >
                Log in
              </Link>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-md hover:bg-gray-100"
              aria-label="Toggle menu"
            >
              {mobileOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t bg-white">
          <div className="px-4 py-3 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100"
              >
                {link.label}
              </Link>
            ))}
            <div className="px-3 pt-2 text-xs font-semibold uppercase text-gray-400">Analysis Tools</div>
            {analysisLinks.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className="block rounded-md px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-100">
                {link.label}
              </Link>
            ))}
            <Link href="/pricing" onClick={() => setMobileOpen(false)} className="block rounded-md px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-100">Pricing</Link>
            {session && (
              <>
                <div className="border-t my-2" />
                <Link
                  href="/account"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100"
                >
                   Account
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
