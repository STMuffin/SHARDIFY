import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { db } from "@/lib/room";
import { PlayerPhoto } from "@/components/player-photo";

type ChatMessage = { id: string; player_id: string; name: string; body: string; created_at: string };

export const RoomChat = memo(function RoomChat({ roomId, playerId, name }: { roomId: string; playerId: string; name: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await db
      .from("chat_messages")
      .select("id, player_id, name, body, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (data) setMessages((data as ChatMessage[]).reverse());
  }, [roomId]);

  useEffect(() => {
    void load();
    // Realtime delivers new messages immediately; the slow poll only repairs missed events.
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    const channel = db
      .channel(`chat-${roomId}`)
      .on(
        "postgres_changes" as never,
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const message = (payload as { new: ChatMessage }).new;
          if (!message?.id) return;
          setMessages((current) =>
            current.some((item) => item.id === message.id)
              ? current
              : [...current, message].slice(-80),
          );
        },
      )
      .subscribe();
    return () => {
      window.clearInterval(id);
      void db.removeChannel(channel);
    };
  }, [load, roomId]);

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
    <section className="panel p-5" aria-label="Chat de la sala">
      <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        <MessageCircle className="size-4" /> Chat
      </h2>
      <div ref={listRef} className="mt-4 h-52 space-y-3 overflow-y-auto pr-1 text-sm" aria-live="polite">
        {messages.length === 0 && <p className="text-xs text-muted-foreground">Nadie ha escrito todavía. ¡Saluda!</p>}
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <PlayerPhoto playerId={m.player_id} name={m.name} className="size-6" />
            <p className="min-w-0 flex-1 break-words leading-relaxed">
              <span className={m.player_id === playerId ? "font-bold text-primary" : "font-bold text-foreground"}>{m.name}</span>{" "}
              <span className="text-muted-foreground">{m.body}</span>
            </p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="mt-4 flex gap-2 border-t border-border pt-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Escribe un mensaje…"
          aria-label="Mensaje de chat"
          className="field-input min-w-0 flex-1 px-3 py-2"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Enviar mensaje"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>
      {failed && <p role="alert" className="mt-2 text-xs text-destructive">No se pudo enviar. Tu mensaje sigue aquí; inténtalo de nuevo.</p>}
    </section>
  );
});
