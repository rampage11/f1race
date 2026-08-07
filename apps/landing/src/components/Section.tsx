import { type ReactNode, useRef } from "react";
import { useInView } from "../lib/useInView";
import { useReducedMotion } from "../lib/useReducedMotion";
import styles from "./Section.module.css";

interface SectionProps {
  id?: string;
  index?: string;
  label: string;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  bare?: boolean;
  bg?: string;
}

export function Section({ id, index, label, title, children, className, bare, bg }: SectionProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, 0.15);
  const reduced = useReducedMotion();
  const shown = reduced || inView;

  return (
    <section
      id={id}
      ref={ref}
      className={[styles.section, shown ? styles.in : styles.out, className].filter(Boolean).join(" ")}
    >
      {bg && <img className={styles.bgImg} src={bg} alt="" aria-hidden="true" loading="lazy" />}
      {bg && <div className={styles.scrim} aria-hidden="true" />}
      {!bare && (
        <div className={`container ${styles.inner}`}>
          <header className={styles.head}>
            <span className={styles.label}>
              {index && <span className={styles.idx}>{index}</span>}
              {label}
            </span>
            {title && <h2 className={styles.title}>{title}</h2>}
          </header>
          {children}
        </div>
      )}
      {bare && children}
    </section>
  );
}
