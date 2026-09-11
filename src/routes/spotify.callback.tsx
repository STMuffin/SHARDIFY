import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { exchangeCode, saveSession } from "@/lib/spotify";

export const Route = createFileRoute("/spotify/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Conectando Spotify — SHARDIFY" },
      { name: "description", content: "Ventana de conexión con tu cuenta de Spotify." },
      { property: "og:title", content: "Conectando Spotify — SHARDIFY" },
      { property: "og:description", content: "Ventana de conexión con tu cuenta de Spotify." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SpotifyCallback,
});

function SpotifyCallback() {
  const [message, setMessage] = useState("Conectando con Spotify…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const send = (payload: Record<string, unknown>) => {
      window.opener?.postMessage({ type: "spotifyAuth", ...payload }, window.location.origin);
      window.setTimeout(() => window.close(), 300);
    };
    const error = params.get("error");
    const code = params.get("code");
    if (error || !code) {
      setMessage("No se completó la conexión.");
      send({ error: error ?? "Falta el código de Spotify." });
      return;
    }
    exchangeCode(code)
      .then((session) => {
        saveSession(session);
        setMessage("¡Listo! Ya puedes cerrar esta ventana.");
        send({ session });
      })
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : "Error al conectar.";
        setMessage(text);
        send({ error: text });
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </main>
  );
}
