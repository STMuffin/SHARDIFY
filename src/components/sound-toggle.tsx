import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { installClickSounds, isMuted, setMuted } from "@/lib/sfx";

export function SoundToggle() {
  const [off, setOff] = useState(false);

  useEffect(() => {
    setOff(isMuted());
    return installClickSounds();
  }, []);

  return (
    <button
      type="button"
      aria-label={off ? "Activar sonidos" : "Silenciar sonidos"}
      onClick={() => {
        const next = !off;
        setMuted(next);
        setOff(next);
      }}
      className="fixed right-4 top-4 z-50 inline-flex size-10 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground backdrop-blur transition hover:border-primary/60 hover:text-primary"
    >
      {off ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
    </button>
  );
}
