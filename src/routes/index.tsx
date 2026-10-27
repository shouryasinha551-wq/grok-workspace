import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { createLab } from "@/simulator/lab";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const hostRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lab = createLab(host, { downloadHref: "/kepler-yard.zip" });
    return () => lab.destroy();
  }, []);

  return (
    <main ref={hostRef} className="ky-host" aria-label="Kepler Yard">
      <p className="ky-boot">Charting the yard</p>
    </main>
  );
}
