import { yandexClientId } from "./identity";

export interface LandingScreenProps {
  onLogin: () => void;
}

const FEATURES: { icon: string; title: string; text: string }[] = [
  { icon: "🛡️", title: "Авторитетный сервер", text: "Честный реалтайм без читов" },
  { icon: "📈", title: "RPG-прогрессия", text: "Тренируй навыки пилота" },
  { icon: "👥", title: "Мультиплеер", text: "Гонки с живыми соперниками" },
];

export function LandingScreen({ onLogin }: LandingScreenProps) {
  const hasYa = !!yandexClientId();
  return (
    <div className="landing">
      <section className="landing-hero">
        <h1 className="landing-title">F1 RACE</h1>
        <p className="landing-tagline">Реалтайм-гонки с RPG-прогрессией пилота</p>
        {hasYa ? (
          <button type="button" className="yandex-btn landing-cta" onClick={onLogin}>
            <svg className="ya-badge" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="4" fill="#FC3F1D" />
              <text x="12" y="17" textAnchor="middle" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#fff">Я</text>
            </svg>
            Войти через Яндекс
          </button>
        ) : (
          <p className="landing-soon">Вход через Яндекс скоро будет доступен</p>
        )}
      </section>

      <section className="feature-cards">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon" aria-hidden="true">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <section className="landing-preview">
        <div className="landing-preview-frame">
          <span>Топ-даун гонка</span>
        </div>
      </section>

      <section className="landing-cta-row">
        {hasYa ? (
          <button type="button" className="yandex-btn landing-cta" onClick={onLogin}>
            <svg className="ya-badge" viewBox="0 0 24 24" aria-hidden="true">
              <rect width="24" height="24" rx="4" fill="#FC3F1D" />
              <text x="12" y="17" textAnchor="middle" fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill="#fff">Я</text>
            </svg>
            Войти через Яндекс
          </button>
        ) : (
          <p className="landing-soon">Вход через Яндекс скоро будет доступен</p>
        )}
      </section>

      <footer className="landing-footer">© F1 Race · Правовая информация появится позже</footer>
    </div>
  );
}
