"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { MapPin } from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
}

export function AppNav({
  links,
  fullName,
  roleBadge,
}: {
  links: NavLink[];
  fullName: string | null;
  roleBadge?: string;
}) {
  const pathname = usePathname();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <MapPin className="size-5 text-primary" />
            JanReport
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {roleBadge && <Badge variant="outline">{roleBadge}</Badge>}
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {fullName}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
