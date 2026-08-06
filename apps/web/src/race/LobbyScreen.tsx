import { useEffect, useState } from "react";
import type { PilotProfile } from "@f1race/race-engine";
import { teamColor } from "./colors";
import type { ConnectionState, LobbyState } from "./useRaceSession";

export function LobbyScreen({ hero, lobby, connectionState }: {
  hero: PilotProfile;
  lobby: LobbyState | null;
  connectionState: ConnectionState;
}) {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 450);
    return () => clearInterval(id);
  }, []);

  const disconnected = connectionState === "disconnected";
  const reconnecting = connectionState === "reconnecting";
  const showDots = !disconnected && !reconnecting;

  const title = disconnected ? "Связь потеряна" : reconnecting ? "Переподключение" : "Поиск гонки";

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="lobby-brand">
          {hero.name} <span className="team-dot-inline" style={{ background: teamColor(hero.team) }} /> · {hero.team}
        </div>

        <div className={`lobby-division ${lobby ? "" : "muted"}`}>{lobby ? lobby.division : "—"}</div>

        <h2 className="lobby-title">
          {title}{showDots && <span className="lobby-dots">{dots}</span>}
        </h2>

        {lobby ? (
          <div className="lobby-info">
            <div>Игроков в очереди: <strong>{lobby.queuedPlayers}</strong></div>
            <div>Ожидание ~{lobby.estimatedWaitSec} с</div>
          </div>
        ) : (
          <p className="lobby-sub">Подбираем соперников вашего уровня…</p>
        )}

        <p className="lobby-hint">Гонка начнётся автоматически, когда найдутся соперники</p>
      </div>
    </div>
  );
}
