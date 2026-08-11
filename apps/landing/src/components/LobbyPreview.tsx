import { Section } from "./Section";
import styles from "./LobbyPreview.module.css";

type Compound = "soft" | "medium" | "hard";

interface Row {
  pos: number;
  no: string;
  name: string;
  tyre: Compound;
  gap: string;
  hero?: boolean;
}

const ROWS: Row[] = [
  { pos: 1, no: "16", name: "Ч. Леклер", tyre: "medium", gap: "—", hero: false },
  { pos: 2, no: "1", name: "М. Ферстаппен", tyre: "medium", gap: "+0.42", hero: false },
  { pos: 3, no: "44", name: "Л. Хэмилтон", tyre: "soft", gap: "+1.18", hero: false },
  { pos: 4, no: "81", name: "О. Пиастри", tyre: "medium", gap: "+2.04", hero: true },
  { pos: 5, no: "4", name: "Л. Норрис", tyre: "hard", gap: "+3.47", hero: false },
  { pos: 6, no: "55", name: "К. Сайнс", tyre: "soft", gap: "+5.12", hero: false },
  { pos: 7, no: "11", name: "С. Перес", tyre: "medium", gap: "+8.66", hero: false },
  { pos: 8, no: "14", name: "Ф. Алонсо", tyre: "hard", gap: "+11.30", hero: false },
];

const TYRE_TOKEN: Record<Compound, string> = {
  soft: "var(--c-tyre-soft)",
  medium: "var(--c-tyre-medium)",
  hard: "var(--c-tyre-hard)",
};

export function LobbyPreview() {
  return (
    <Section id="multiplayer" index="02" label="SECTOR 2 — Мультиплеер" title="Против живых людей, не ботов" bg="/img/sector-multiplayer.webp">
      <div className={styles.card}>
        <div className={`mono ${styles.head}`}>ROOM · RED BULL RING · LAP 4/12</div>
        <ul className={styles.list}>
          {ROWS.map((r) => (
            <li key={r.pos} className={[styles.row, r.hero ? styles.hero : ""].filter(Boolean).join(" ")}>
              <span className={`mono ${styles.pos}`}>{r.pos}</span>
              <span className={styles.plate}>
                <span className={`mono ${styles.plateNo}`}>{r.no}</span>
              </span>
              <span className={styles.name}>{r.name}</span>
              <span className={styles.tyre} style={{ background: TYRE_TOKEN[r.tyre] }} title={r.tyre} />
              <span className={`mono ${styles.gap}`}>{r.gap}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.notes}>
        <p className={`mono ${styles.note}`}>
          Чистый топ-даун вид — вся физика, без 3D-шума. В гонке машины идут в цветах команд.
        </p>
      </div>
    </Section>
  );
}
