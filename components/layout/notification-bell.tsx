"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bell, MapPinned } from "lucide-react";
import { useIssueNotifications, type NearbyAlert } from "@/lib/hooks/use-issue-notifications";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function NotificationBell({
  userId,
  initialAlerts,
}: {
  userId: string;
  initialAlerts: NearbyAlert[];
}) {
  const { alerts, unreadCount, markAllRead } = useIssueNotifications(
    userId,
    initialAlerts
  );

  return (
    <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "relative"
        )}
        aria-label="Nearby alerts"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <Badge className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Nearby alerts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground">
            <MapPinned className="size-5" />
            <p>No nearby alerts yet.</p>
            <Link href="/alerts" className="text-primary underline underline-offset-2">
              Set up your alert radius
            </Link>
          </div>
        ) : (
          <>
            {alerts.slice(0, 8).map((alert) => (
              <DropdownMenuItem key={alert.id} render={<Link href={`/issues/${alert.issueId}`} />}>
                <AlertRow alert={alert} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/alerts" />} className="justify-center text-primary">
              View all alerts
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AlertRow({ alert }: { alert: NearbyAlert }) {
  const categoryLabel =
    CATEGORY_LABELS[alert.issueCategory as IssueCategory] ?? alert.issueCategory;

  return (
    <div className="flex w-full flex-col gap-0.5 py-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{categoryLabel} nearby</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
        </span>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {alert.issueAddress ?? alert.issueTitle}
      </p>
    </div>
  );
}
