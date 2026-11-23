import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  applyTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
  type ThemePreference,
} from "@/lib/theme";

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setPreference(getThemePreference());
  }, []);

  useEffect(() => {
    if (!preference) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const resolved = resolveTheme(preference, media.matches);
      applyTheme(resolved);
      setDark(resolved === "dark");
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  const next = dark ? "light" : "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={`Cambiar a modo ${next === "dark" ? "oscuro" : "claro"}`}
      title={`Cambiar a modo ${next === "dark" ? "oscuro" : "claro"}`}
      className="size-9 rounded-full border-border bg-background text-foreground shadow-none hover:bg-secondary hover:text-foreground"
      onClick={() => {
        const update = () => {
          setPreference(next);
          setThemePreference(next);
          setDark(next === "dark");
        };
        if (typeof document.startViewTransition === "function") {
          document.startViewTransition(update);
        } else {
          update();
        }
      }}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
