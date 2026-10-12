import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RoomShare({ code }: { code: string }) {
  const [message, setMessage] = useState("");
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);

  async function copy(link: boolean) {
    try {
      await navigator.clipboard.writeText(link ? `${window.location.origin}/sala/${code}` : code);
      setMessage(link ? "Enlace copiado" : "Código copiado");
    } catch {
      setMessage("No se pudo copiar. Código: " + code);
    }
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setMessage(""), 3000);
  }

  return (
    <div className="relative flex items-center gap-2">
      <Button variant="outline" className="h-auto gap-3 bg-card/60 px-3 py-2" onClick={() => void copy(false)} title="Copiar código" aria-label="Copiar código de sala">
        <span className="text-left"><span className="block text-[10px] uppercase text-muted-foreground">Sala</span>
          <span className="font-display text-xl font-bold text-primary">{code}</span></span>
        {message === "Código copiado" ? <Check /> : <Copy />}
      </Button>
      <Button variant="outline" size="icon" title="Copiar enlace de invitación" aria-label="Copiar enlace de invitación" onClick={() => void copy(true)}><Share2 /></Button>
      <span role="status" className="absolute right-0 top-full mt-1 whitespace-nowrap text-xs text-primary">{message}</span>
    </div>
  );
}