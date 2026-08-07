import { beginYandexLogin, isYandexConfigured } from "../lib/oauth";
import styles from "./CtaButton.module.css";

interface CtaButtonProps {
  label?: string;
  className?: string;
}

export function CtaButton({ label = "Войти через Яндекс", className }: CtaButtonProps) {
  const configured = isYandexConfigured();
  return (
    <button
      type="button"
      className={[styles.cta, className].filter(Boolean).join(" ")}
      onClick={() => configured && beginYandexLogin()}
      disabled={!configured}
      data-configured={configured ? "1" : "0"}
    >
      {configured ? label : "Скоро"}
    </button>
  );
}
