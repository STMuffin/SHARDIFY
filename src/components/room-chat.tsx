import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { db } from "@/lib/room";
import { PlayerPhoto } from "@/components/player-photo";

type ChatMessage = { id: string; player_id: string; name: string; body: string; created_at: string };

export function RoomChat({ roomId, playerId, name }: { roomId: string; playerId: string; name: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function load() {
    const { data } = await db
      .from("chat_messages")
      .select("id, player_id, name, body, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (data) setMessages((data as ChatMessage[]).reverse());
  }

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 1500);
    const channel = db
      .channel(`chat-${roomId}`)
      .on("postgres_changes" as never, { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    return () => {
      window.clearInterval(id);
      void db.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setFailed(false);
    const { error } = await db
      .from("chat_messages")
      .insert({ room_id: roomId, player_id: playerId, name: name.slice(0, 40), body: body.slice(0, 300) });
    setSending(false);
    if (error) {
      setFailed(true);
      return;
    }
    setText("");
    void load();
  }

  return (
    <div className="panel mt-6 p-4">
      <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.2em] text-muted-foreground">
        <MessageCircle className="size-4" /> Chat
      </h3>
      <div ref={listRef} className="mt-3 h-56 space-y-1.5 overflow-y-auto pr-1 text-sm">
        {messages.length === 0 && <p className="text-xs text-muted-foreground">Nadie ha escrito todavía. ¡Saluda!</p>}
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <PlayerPhoto playerId={m.player_id} name={m.name} className="size-6" />
            <p className="min-w-0 flex-1 break-words">
            <span className={m.player_id === playerId ? "font-bold text-primary" : "font-bold text-foreground"}>{m.name}:</span>{" "}
            <span className="text-muted-foreground">{m.body}</span>
            </p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Escribe un mensaje…"
          aria-label="Mensaje de chat"
          className="min-w-0 flex-1 rounded-xl border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button type="submit" disabled={sending || !text.trim()} aria-label="Enviar mensaje" className="rounded-xl bg-primary px-3 text-primary-foreground disabled:opacity-60">
          <Send className="size-4" />
        </button>
      </form>
      {failed && <p className="mt-2 text-xs text-destructive">No se pudo enviar. Inténtalo de nuevo.</p>}
    </div>
  );
}
