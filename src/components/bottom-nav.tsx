import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Images, Settings } from "lucide-react";

const TABS = [
  { to: "/", label: "首页", icon: Home },
  { to: "/courses", label: "课程库", icon: Images },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="shrink-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex h-16 max-w-lg">
        {TABS.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              replace
              className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs transition-colors active:bg-muted/60 ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
