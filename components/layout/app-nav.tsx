"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Menu, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

export interface NavLink {
  href: string;
  labelKey: TranslationKey;
}

export function AppNav({
  links,
  fullName,
  roleBadge,
  notificationBell,
}: {
  links: NavLink[];
  fullName: string | null;
  roleBadge?: string;
  notificationBell?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <MapPin className="size-5 text-primary" />
            JanReport
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
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
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {roleBadge && <Badge variant="outline">{roleBadge}</Badge>}
          {notificationBell}
          <LanguageToggle />
          <span className="text-sm text-muted-foreground">{fullName}</span>
          <SignOutButton />
        </div>

        <div className="flex items-center gap-1 md:hidden">
          {roleBadge && <Badge variant="outline">{roleBadge}</Badge>}
          {notificationBell}
          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t bg-background md:hidden">
          <nav className="flex flex-col gap-1 px-4 py-3">
            {links.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="truncate text-sm text-muted-foreground">
              {fullName}
            </span>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <SignOutButton />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
