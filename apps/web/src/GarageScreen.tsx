import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { DriverProfileSummary } from "./identity";
import {
  buyCosmetic,
  equipCosmetic,
  fetchCosmeticsCatalog,
  fetchCosmeticsOwned,
} from "./api";
import type { CosmeticDef, CosmeticType, EquippedCosmetics } from "./api";
import styles from "./LeaderboardScreen.module.css";

export interface GarageScreenProps {
  profile: DriverProfileSummary;
  onProfileChanged: (profile: DriverProfileSummary, softCurrency: number, equipped: EquippedCosmetics) => void;
  onClose: () => void;
}

interface OwnedState {
  owned: string[];
  equipped: EquippedCosmetics;
  softCurrency: number;
}

function isHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

export function GarageScreen({ profile, onProfileChanged, onClose }: GarageScreenProps) {
  const [catalog, setCatalog] = useState<CosmeticDef[]>([]);
  const [owned, setOwned] = useState<OwnedState>({ owned: [], equipped: {}, softCurrency: profile.softCurrency ?? 0 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const applyOwned = useCallback(
    (data: OwnedState) => {
      setOwned(data);
      onProfileChanged(profile, data.softCurrency, data.equipped);
    },
    [onProfileChanged, profile],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCosmeticsCatalog(), fetchCosmeticsOwned()]).then(([cat, own]) => {
      if (cancelled) return;
      if (cat) setCatalog(cat);
      if (own) {
        const next: OwnedState = { owned: own.owned, equipped: own.equipped, softCurrency: own.softCurrency };
        setOwned(next);
        onProfileChanged(own.profile, own.softCurrency, own.equipped);
      }
    });
    return () => {
      cancelled = true;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [onProfileChanged]);

  const handleBuy = async (def: CosmeticDef) => {
    if (busyId) return;
    setBusyId(def.id);
    setError(null);
    const r = await buyCosmetic(def.id);
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    applyOwned({ owned: r.owned, equipped: r.equipped, softCurrency: r.softCurrency });
    onProfileChanged(r.profile, r.softCurrency, r.equipped);
    showToast(`Куплено: ${def.value}`);
  };

  const handleEquip = async (def: CosmeticDef) => {
    if (busyId) return;
    setBusyId(def.id);
    setError(null);
    const r = await equipCosmetic(def.id);
    setBusyId(null);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    applyOwned({ owned: r.owned, equipped: r.equipped, softCurrency: r.softCurrency });
    onProfileChanged(r.profile, r.softCurrency, r.equipped);
    showToast(`Экипировано: ${def.value}`);
  };

  const byType = (t: CosmeticType) => catalog.filter((c) => c.type === t);
  const accentColors = byType("accentColor");
  const carNumbers = byType("carNumber");

  const renderRow = (def: CosmeticDef) => {
    const isOwned = owned.owned.includes(def.id);
    const equippedId = owned.equipped[def.type];
    const isEquipped = equippedId === def.id;
    const levelMet = profile.level >= def.level;
    const fundsMet = owned.softCurrency >= def.cost;
    const swatch = def.type === "accentColor" && isHexColor(def.value) ? def.value : null;

    return (
      <div
        key={def.id}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "12px 14px",
          background: "var(--bg-elevated)",
          border: `1px solid ${isEquipped ? "var(--accent-green)" : "var(--border-subtle)"}`,
          borderRadius: 10,
          opacity: !levelMet ? 0.55 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {swatch ? (
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: swatch, border: "1px solid rgba(0,0,0,0.45)", flex: "none" }} />
          ) : (
            <span className="ds-mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", minWidth: 28, textAlign: "center" }}>
              {def.value}
            </span>
          )}
          <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{def.value}</span>
          {isEquipped && <span style={{ fontSize: 11, color: "var(--accent-green)", fontWeight: 700 }}>надето ✓</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
          {!levelMet ? (
            <span style={{ color: "var(--accent-red)" }}>🔒 Уровень {def.level}</span>
          ) : isOwned ? (
            <span>Куплено</span>
          ) : (
            <span style={{ color: fundsMet ? "var(--accent-gold)" : "var(--accent-red)" }}>{def.cost} CR</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {!isOwned ? (
            <button
              onClick={() => handleBuy(def)}
              disabled={!levelMet || !fundsMet || busyId !== null}
              style={btnStyle(!levelMet || !fundsMet)}
            >
              {busyId === def.id ? "…" : "Купить"}
            </button>
          ) : !isEquipped ? (
            <button onClick={() => handleEquip(def)} disabled={busyId !== null} style={btnStyle(false, true)}>
              {busyId === def.id ? "…" : "Надеть"}
            </button>
          ) : (
            <span style={{ fontSize: 11, color: "var(--accent-green)", alignSelf: "center", fontWeight: 700 }}>Активно</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Гараж">
      <div className={`glass-panel ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Закрыть">×</button>

        <header className={styles.header}>
          <h2 className="ds-heading">Гараж</h2>
          <div className={styles.meBanner} style={{ margin: 0, background: "rgba(255, 214, 10, 0.1)", borderColor: "rgba(255, 214, 10, 0.35)", color: "var(--accent-gold)" }}>
            <span>🪙 {owned.softCurrency} CR</span>
            <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>Ур. {profile.level}</span>
          </div>
        </header>

        {toast && (
          <div className={styles.meBanner} style={{ background: "rgba(0, 210, 106, 0.12)", borderColor: "rgba(0, 210, 106, 0.4)", color: "var(--accent-green)" }}>
            {toast}
          </div>
        )}
        {error && (
          <div className={styles.meBanner} style={{ background: "rgba(255, 45, 85, 0.10)", borderColor: "rgba(255, 45, 85, 0.4)", color: "var(--accent-red)" }}>
            {error}
          </div>
        )}

        <div className={styles.list} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section>
            <h3 className="ds-heading" style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-secondary)" }}>Цвет акцента</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {accentColors.length === 0 ? <p className={styles.empty}>Загрузка…</p> : accentColors.map(renderRow)}
            </div>
          </section>
          <section>
            <h3 className="ds-heading" style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-secondary)" }}>Номер машины</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {carNumbers.length === 0 ? <p className={styles.empty}>Загрузка…</p> : carNumbers.map(renderRow)}
            </div>
          </section>
        </div>

        <p className={styles.note}>Косметика — только внешний вид, на гонку не влияет.</p>
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean, primary = false): CSSProperties {
  return {
    flex: 1,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "var(--font-display)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: disabled ? "var(--text-tertiary)" : primary ? "#04161a" : "var(--text-primary)",
    background: disabled ? "var(--bg-surface)" : primary ? "var(--accent-green)" : "var(--bg-surface)",
    border: `1px solid ${disabled ? "var(--border-subtle)" : primary ? "var(--accent-green)" : "var(--border-active)"}`,
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
