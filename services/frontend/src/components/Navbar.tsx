"use client";

import Link from "next/link";
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

export function Navbar() {
  const { data: session } = useSession();
  const user = session?.user as any;

  return (
    <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">💰</span>
            <span className="font-bold text-lg">VP Strategy</span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/scanner" className="text-sm font-medium text-gray-700 hover:text-gray-900">
              Scanner
            </Link>
            <Link href="/accumulation" className="text-sm font-medium text-gray-700 hover:text-gray-900">
              Accumulation
            </Link>
            <Link href="/fusion" className="text-sm font-medium text-gray-700 hover:text-gray-900">
              Fusion
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-gray-700 hover:text-gray-900">
              Pricing
            </Link>
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-4">
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">
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
                    <Link href="/account">帳號設定</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href="/pricing">升級方案</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut()}>
                    登出
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href="/login"
                className="bg-black text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-800"
              >
                登入
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
