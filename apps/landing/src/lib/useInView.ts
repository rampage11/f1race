import { useEffect, useRef, useState, type RefObject } from "react";

export function useInView(
  ref: RefObject<Element | null>,
  threshold = 0.2,
  once = true,
): boolean {
  const [inView, setInView] = useState(false);
  const seen = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            if (once && seen.current) return;
            seen.current = true;
            setInView(true);
            if (once) obs.disconnect();
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, threshold, once]);

  return inView;
}
