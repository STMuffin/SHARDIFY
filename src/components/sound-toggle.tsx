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
        <Button variant="outline" size="icon" aria-label="Ajustes de sonido" title="Ajustes de sonido"
          className="fixed right-4 top-4 z-50 size-10 rounded-full bg-card/90 text-muted-foreground backdrop-blur">
          {off && volume === 0 ? <VolumeX /> : <Volume2 />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="mr-4 w-64 space-y-5">
        <h2 className="font-display font-bold">Sonido</h2>
        <label className="block space-y-3">
          <span className="flex justify-between text-sm"><span>Música</span><span className="text-muted-foreground">{Math.round(volume * 100)}%</span></span>
          <input type="range" min={0} max={100} value={Math.round(volume * 100)} aria-label="Volumen de música"
            className="w-full accent-primary" onChange={(e) => {
              const next = Number(e.target.value) / 100;
              setVolume(next);
              setMusicVolume(next);
            }} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          Efectos del juego
          <input type="checkbox" checked={!off} className="size-4 accent-primary" onChange={(e) => {
            const next = !e.target.checked;
            setMuted(next);
            setOff(next);
          }} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
