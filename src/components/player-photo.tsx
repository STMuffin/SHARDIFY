import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getRoomProfilePhotos, uploadProfilePhoto } from "@/lib/profile-photo.functions";
import { prepareProfilePhoto } from "@/lib/profile-photo";
import type { PlayerRow } from "@/lib/room";

const PhotoContext = createContext<{ photos: Record<string, string>; refresh: () => Promise<void> }>({ photos: {}, refresh: async () => {} });

export function PlayerPhotos({ me, clientKey, children }: { me: PlayerRow; clientKey: string; children: ReactNode }) {
  const getPhotos = useServerFn(getRoomProfilePhotos);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    try {
      const result = await getPhotos({ data: { playerId: me.id, roomId: me.room_id, clientKey } });
      const browserOrigin = import.meta.env['VITE_SUPABASE_URL'];
      setPhotos(Object.fromEntries(Object.entries(result).map(([id, url]) => {
        const parsed = new URL(url);
        return [id, browserOrigin ? `${browserOrigin}${parsed.pathname}${parsed.search}` : url];
      })));
    } catch { /* Keep existing photos during temporary connection failures. */ }
  }, [getPhotos, me.id, me.room_id, clientKey]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return <PhotoContext.Provider value={{ photos, refresh }}>{children}</PhotoContext.Provider>;
}

export function PlayerPhoto({ playerId, name, className = "size-8" }: { playerId: string; name: string; className?: string }) {
  const { photos } = useContext(PhotoContext);
  return <Avatar className={className}>
    <AvatarImage src={photos[playerId]} alt={`Foto de ${name}`} className="object-cover" />
    <AvatarFallback className="text-xs font-bold text-primary">{name.trim().slice(0, 2).toUpperCase()}</AvatarFallback>
  </Avatar>;
}

export function ProfilePhotoUpload({ me, clientKey }: { me: PlayerRow; clientKey: string }) {
  const upload = useServerFn(uploadProfilePhoto);
  const { refresh } = useContext(PhotoContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function change(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const photo = await prepareProfilePhoto(file);
      await upload({ data: { photo, playerId: me.id, roomId: me.room_id, clientKey } });
      await refresh();
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo subir la foto."); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  return <div className="mb-6 border-b border-border pb-5">
    <div className="flex min-w-0 items-center gap-3">
      <PlayerPhoto playerId={me.id} name={me.name} className="size-12" />
      <div className="min-w-0 flex-1"><p className="break-words font-bold text-foreground">{me.name}</p><p className="text-xs text-muted-foreground">Tu perfil</p></div>
      <Button variant="outline" size="icon" title="Cambiar foto de perfil" aria-label="Cambiar foto de perfil" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Camera />}
      </Button>
      <input ref={inputRef} type="file" accept="image/*" aria-label="Foto de perfil" className="hidden" onChange={(event) => void change(event.target.files?.[0])} />
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {saved && <p role="status" className="mt-2 text-xs text-primary">Foto actualizada.</p>}
  </div>;
}