import { useMemo, useState } from "react";
import { Loader2, Music4 } from "lucide-react";

import type { UserPlaylist } from "@/lib/spotify";

export function PlaylistPicker({
  playlists,
  loading,
  selected,
  onToggle,
}: {
  playlists: UserPlaylist[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter(
      (p) => p.name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q),
    );
  }, [playlists, query]);

  const selectedCount = selected.size;
  const selectedTracks = playlists
    .filter((p) => selected.has(p.id))
    .reduce((sum, p) => sum + p.tracks, 0);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background/40 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando tus playlists…
      </div>
    );
  }

  if (!playlists.length) {
    return (
      <p className="rounded-xl border border-border bg-background/40 px-4 py-4 text-sm text-muted-foreground">
        No encontré playlists en esta cuenta. Puedes pegar un enlace abajo.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Tus playlists
        </span>
        <span className="text-xs text-muted-foreground">
          {selectedCount
            ? `${selectedCount} seleccionada${selectedCount === 1 ? "" : "s"} · ${selectedTracks} canciones`
            : `${playlists.length} disponibles`}
        </span>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar playlist…"
        className="w-full rounded-xl border border-input bg-background/60 px-4 py-2.5 text-sm outline-none transition focus:border-primary"
      />
      <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-background/40 p-2">
        {filtered.map((playlist) => {
          const active = selected.has(playlist.id);
          return (
            <li key={playlist.id}>
              <button
                type="button"
                onClick={() => onToggle(playlist.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition ${
                  active
                    ? "bg-primary/15 ring-1 ring-primary/50"
                    : "hover:bg-background/80"
                }`}
              >
                {playlist.image ? (
                  <img
                    src={playlist.image}
                    alt=""
                    className="size-10 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Music4 className="size-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {playlist.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {playlist.tracks} canciones
                    {playlist.owner ? ` · ${playlist.owner}` : ""}
                  </span>
                </span>
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            </li>
          );
        })}
        {!filtered.length && (
          <li className="px-3 py-4 text-center text-xs text-muted-foreground">
            Ninguna playlist coincide con “{query}”.
          </li>
        )}
      </ul>
    </div>
  );
}
