import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { installClickSounds, isMuted, setMuted } from "@/lib/sfx";
import { getMusicVolume, setMusicVolume } from "@/lib/audio-settings";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SoundToggle() {
  const [off, setOff] = useState(false);
  const [volume, setVolume] = useState(0.9);

  useEffect(() => {
    setOff(isMuted());
    setVolume(getMusicVolume());
    return installClickSounds();
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ajustes de sonido"
          title="Ajustes de sonido"
          className="size-9 rounded-full border-border bg-background text-foreground shadow-none hover:bg-secondary hover:text-foreground"
        >
          {off && volume === 0 ? <VolumeX /> : <Volume2 />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-5 rounded-2xl border-border bg-popover p-5">
        <h2 className="font-display text-base">Sonido</h2>
        <label className="block space-y-3">
          <span className="flex justify-between text-sm">
            <span>Música</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(volume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            aria-label="Volumen de música"
            className="w-full accent-primary"
            onChange={(e) => {
              const next = Number(e.target.value) / 100;
              setVolume(next);
              setMusicVolume(next);
            }}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Efectos del juego
          <input
            type="checkbox"
            checked={!off}
            className="size-4 accent-primary"
            onChange={(e) => {
              const next = !e.target.checked;
              setMuted(next);
              setOff(next);
            }}
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}
