import { useEffect, useRef, useState } from "react";
import type { PilotProfile } from "@f1race/race-engine";
import { SetupScreen } from "./race/SetupScreen";
import { RaceView } from "./race/RaceView";
import {
  beginYandexLogin,
  clearAuth,
  consumeYandexState,
  exchangeYandexCode,
  getAuthProfile,
  getOrCreateGuestId,
  isYandexCallbackPath,
  readCachedProfile,
  readYandexCallbackParams,
  setAuthProfile,
  setAuthToken,
} from "./identity";
import type { DriverProfileSummary } from "./identity";

type CallbackStatus =
  | { kind: "idle" }
  | { kind: "exchanging" }
  | { kind: "error"; message: string };

export default function App() {
  const [guestId] = useState(() => getOrCreateGuestId());
  const [hero, setHero] = useState<PilotProfile | null>(null);
  const [authProfile, setAuthProfileState] = useState<DriverProfileSummary | null>(() => getAuthProfile());
  const [callbackStatus, setCallbackStatus] = useState<CallbackStatus>(() =>
    isYandexCallbackPath() ? { kind: "exchanging" } : { kind: "idle" },
  );
  const processedRef = useRef(false);

  useEffect(() => {
    if (!isYandexCallbackPath()) return;
    if (processedRef.current) return;
    processedRef.current = true;

    const { code, state, error } = readYandexCallbackParams();
    const redirectUri = `${window.location.origin}/yandex-callback`;

    if (error) {
      window.history.replaceState({}, "", "/");
      setCallbackStatus({ kind: "error", message: `Яндекс отклонил вход: ${error}` });
      return;
    }
    if (!consumeYandexState(state)) {
      window.history.replaceState({}, "", "/");
      setCallbackStatus({ kind: "error", message: "Яндекс: неверный state, попробуйте снова" });
      return;
    }
    if (!code) {
      window.history.replaceState({}, "", "/");
      setCallbackStatus({ kind: "error", message: "Яндекс не вернул код авторизации" });
      return;
    }

    let cancelled = false;
    exchangeYandexCode(code, redirectUri).then((result) => {
      if (cancelled) return;
      window.history.replaceState({}, "", "/");
      if (result.ok && result.sessionToken && result.profile) {
        setAuthToken(result.sessionToken);
        setAuthProfile(result.profile);
        setAuthProfileState(result.profile);
        setCallbackStatus({ kind: "idle" });
      } else if (result.notConfigured) {
        setCallbackStatus({ kind: "error", message: "Вход через Яндекс недоступен" });
      } else {
        setCallbackStatus({ kind: "error", message: result.error ?? "Не удалось войти через Яндекс" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (callbackStatus.kind === "exchanging") {
    return (
      <div className="oauth-loading">
        <div className="oauth-spinner" />
        <p>Вход через Яндекс…</p>
      </div>
    );
  }

  if (!hero) {
    const cached = readCachedProfile();
    const initialHero = authProfile?.hero ?? cached?.hero;
    return (
      <>
        {callbackStatus.kind === "error" && (
          <div className="oauth-toast">{callbackStatus.message}</div>
        )}
        <SetupScreen
          initialHero={initialHero}
          authProfile={authProfile}
          onLoginYandex={beginYandexLogin}
          onLogout={() => {
            clearAuth();
            setAuthProfileState(null);
            setCallbackStatus({ kind: "idle" });
          }}
          onStart={(cfg) => setHero(cfg)}
        />
      </>
    );
  }
  return <RaceView hero={hero} guestId={guestId} onChangeDriver={() => setHero(null)} />;
}
