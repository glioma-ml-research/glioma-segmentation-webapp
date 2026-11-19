import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Fades and lifts its content in the first time it scrolls into view (CSS: .reveal / .is-in). */
export function Reveal({ children, className = "", index = 0, as: Tag = "div" }: { children: ReactNode; className?: string; index?: number; as?: "div" | "section" | "li" | "article" }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={`reveal${shown ? " is-in" : ""} ${className}`} style={{ "--i": index } as CSSProperties}>
      {children}
    </Tag>
  );
}

/** Lets .spot surfaces light up under the cursor: one listener for the whole page. */
export function useSpotlight() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (event: PointerEvent) => {
      const surface = (event.target as Element | null)?.closest?.(".spot") as HTMLElement | null;
      if (!surface) return;
      const box = surface.getBoundingClientRect();
      surface.style.setProperty("--mx", `${event.clientX - box.left}px`);
      surface.style.setProperty("--my", `${event.clientY - box.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
}

/** Region colours until /api/info answers; the backend's label map is the source of truth. */
export const DEFAULT_COLOURS: Record<number, string> = { 1: "#F2C200", 2: "#2FA84F", 3: "#E0332B", 4: "#2F7DE1" };

/** The tumor cross-section motif (edema, enhancing rim, core, cavity) with a slowly sweeping scan line. */
export function RingsArt({ className = "hero-art" }: { className?: string }) {
  const rings = [
    { inset: "0%", color: DEFAULT_COLOURS[2] },
    { inset: "17%", color: DEFAULT_COLOURS[3] },
    { inset: "31%", color: DEFAULT_COLOURS[4] },
    { inset: "42%", color: DEFAULT_COLOURS[1] },
  ];
  return (
    <div className={className} aria-hidden="true">
      {rings.map((ring) => (
        <span key={ring.inset} className="art-ring" style={{ "--inset": ring.inset, "--color": ring.color } as CSSProperties} />
      ))}
      <span className="art-scan" />
    </div>
  );
}
