import { useEffect, useRef, useState } from "react";
import type { PilotProfile } from "@f1race/race-engine";
import { SetupScreen } from "./race/SetupScreen";
import { RaceView } from "./race/RaceView";
import { LandingScreen } from "./LandingScreen";
import { HubScreen } from "./HubScreen";
import { confirmHero } from "./api";
import {
  beginYandexLogin,
  clearAuth,
  consumeYandexState,
  exchangeYandexCode,
  getAuthProfile,
  getOrCreateGuestId,
  isYandexCallbackPath,
  readYandexCallbackParams,
  setAuthProfile,
  setAuthToken,
} from "./identity";
import type { DriverProfileSummary } from "./identity";

type CallbackStatus =
  | { kind: "idle" }
  | { kind: "exchanging" }
  | { kind: "error"; message: string };

type Screen = "landing" | "onboarding" | "hub" | "race";

function deriveInitialScreen(p: DriverProfileSummary | null): Screen {
  if (!p) return "landing";
  return p.heroConfirmed ? "hub" : "onboarding";
}

export default function App() {
  const [guestId] = useState(() => getOrCreateGuestId());
  const [authProfile, setAuthProfileState] = useState<DriverProfileSummary | null>(() => getAuthProfile());
  const [screen, setScreen] = useState<Screen>(() => deriveInitialScreen(getAuthProfile()));
  const [callbackStatus, setCallbackStatus] = useState<CallbackStatus>(() =>
    isYandexCallbackPath() ? { kind: "exchanging" } : { kind: "idle" },
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
        setScreen(deriveInitialScreen(result.profile));
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

  async function handleConfirm(cfg: PilotProfile) {
    setConfirming(true);
    setConfirmError(null);
    const result = await confirmHero(cfg);
    setConfirming(false);
    if (!result.ok || !result.profile) {
      setConfirmError(result.error ?? "Не удалось сохранить пилота");
      return;
    }
    setAuthProfile(result.profile);
    setAuthProfileState(result.profile);
    setScreen(result.profile.heroConfirmed ? "hub" : "onboarding");
  }

  function handleLogout() {
    clearAuth();
    setAuthProfileState(null);
    setScreen("landing");
  }

  if (callbackStatus.kind === "exchanging") {
    return (
      <div className="oauth-loading">
        <div className="oauth-spinner" />
        <p>Вход через Яндекс…</p>
      </div>
    );
  }

  let active: Screen;
  if (screen === "race" && authProfile) {
    active = "race";
  } else if (!authProfile) {
    active = "landing";
  } else if (!authProfile.heroConfirmed) {
    active = "onboarding";
  } else {
    active = "hub";
  }

  return (
    <>
      {callbackStatus.kind === "error" && (
        <div className="oauth-toast">{callbackStatus.message}</div>
      )}
      {active === "landing" && <LandingScreen onLogin={beginYandexLogin} />}
      {active === "onboarding" && authProfile && (
        <SetupScreen
          mode="onboarding"
          initialHero={authProfile.hero}
          authProfile={authProfile}
          onStart={handleConfirm}
          submitting={confirming}
          submitError={confirmError}
        />
      )}
      {active === "hub" && authProfile && (
        <HubScreen
          profile={authProfile}
          onRace={() => setScreen("race")}
          onLogout={handleLogout}
        />
      )}
      {active === "race" && authProfile && (
        <RaceView
          hero={authProfile.hero}
          guestId={guestId}
          onChangeDriver={() => {
            setScreen("hub");
            setAuthProfileState(getAuthProfile());
          }}
        />
      )}
    </>
  );
}
