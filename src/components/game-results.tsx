import { Check, Flame, Minus, RotateCcw, Trophy, X } from "lucide-react";
import { AnimatedScore } from "./animated-score";
import { PlayerPhoto } from "./player-photo";
import { Button } from "./ui/button";
import { getPlayerGameResults, type RoundResult } from "@/lib/game-results";
import type { GuessRow, PlayerRow } from "@/lib/room";

const outcomeLabels: Record<RoundResult, string> = {
  correct: "Acierto", partial: "Parcial", wrong: "Error", unanswered: "Sin responder",
};
const outcomeClasses: Record<RoundResult, string> = {
  correct: "bg-success/15 text-success border-success/30",
  partial: "bg-primary/15 text-primary border-primary/30",
  wrong: "bg-destructive/15 text-destructive border-destructive/30",
  unanswered: "bg-secondary text-muted-foreground border-border",
};

export function GameResults({ players, guesses, mode, rounds, myId, teams, onPlayAgain, busy }: {
  players: PlayerRow[];
  guesses: GuessRow[];
  mode: string;
  rounds: number;
  myId: string;
  teams: { team: string; total: number }[];
  onPlayAgain?: (() => void) | undefined;
  busy: boolean;
}) {
  return (
    <div className="rise-in">
      <div className="text-center">
        <Trophy className="mx-auto mb-3 size-8 text-accent" aria-hidden="true" />
        <h2 className="font-display text-3xl font-bold">Fin de la partida</h2>
        <p className="mt-2 text-sm text-muted-foreground">{rounds} rondas · Resultados finales</p>
      </div>
      {teams.length > 0 && (
        <ol className="mt-6 divide-y divide-border" aria-label="Clasificación por equipos">
          {teams.map((team, index) => (
            <li key={team.team} className="flex items-center justify-between gap-3 py-3">
              <span className="font-semibold">{index + 1}. Equipo {team.team}</span>
              <AnimatedScore value={team.total} suffix=" pts" className="font-display font-bold text-primary" />
            </li>
          ))}
        </ol>
      )}
      <h3 className="mt-7 text-sm font-semibold text-muted-foreground">Estadísticas por jugador</h3>
      <ol className="mt-3 space-y-3" aria-label="Resultados por jugador">
        {players.map((player, index) => {
          const result = getPlayerGameResults(guesses, player.id, mode, rounds);
          return (
            <li key={player.id} aria-label={`Resultados de ${player.name}`} className={`min-w-0 rounded-lg border p-4 ${player.id === myId ? "border-primary/40 bg-primary/5" : "border-border bg-background/40"}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-5 shrink-0 font-display text-lg font-bold text-primary">{index + 1}</span>
                  <PlayerPhoto playerId={player.id} name={player.name} />
                  <div className="min-w-0">
                    <p className="break-words font-semibold">{player.name}{player.id === myId && <span className="ml-2 text-xs text-muted-foreground">Tú</span>}</p>
                    {player.team && <p className="text-xs text-muted-foreground">Equipo {player.team}</p>}
                  </div>
                </div>
                <AnimatedScore value={player.score} suffix=" pts" className="shrink-0 font-display font-bold" />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
                <div><dt className="flex items-center gap-1 text-xs text-success"><Check className="size-3.5" /> Aciertos</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums">{result.correct}</dd></div>
                <div><dt className="flex items-center gap-1 text-xs text-destructive"><X className="size-3.5" /> Errores</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums">{result.wrong}</dd></div>
                <div><dt className="flex items-center gap-1 text-xs text-accent"><Flame className="size-3.5" /> Mejor racha</dt><dd className="mt-1 font-display text-xl font-bold tabular-nums">{result.bestStreak}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {mode === "type" && <span>{result.partial} parciales</span>}
                <span>{result.unanswered} sin responder</span>
                <span>Racha final: {result.streak}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`Rondas de ${player.name}`}>
                {result.outcomes.map((outcome, round) => (
                  <span key={round} title={`Ronda ${round + 1}: ${outcomeLabels[outcome]}`} aria-label={`Ronda ${round + 1}: ${outcomeLabels[outcome]}`} className={`flex size-6 items-center justify-center rounded border ${outcomeClasses[outcome]}`}>
                    {outcome === "correct" ? <Check className="size-3.5" /> : outcome === "wrong" ? <X className="size-3.5" /> : outcome === "partial" ? <span className="text-xs font-bold">½</span> : <Minus className="size-3.5" />}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 text-center">
        {onPlayAgain ? <Button onClick={onPlayAgain} disabled={busy} size="lg"><RotateCcw /> Jugar otra vez</Button> : <p role="status" className="text-sm text-muted-foreground">Esperando al anfitrión para volver a jugar…</p>}
      </div>
    </div>
  );
}