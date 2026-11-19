import { useEffect, useState } from "react";

import { getInfo, listSamples } from "./api";
import type { ApiInfo, SampleCase } from "./types";

let infoRequest: Promise<ApiInfo> | null = null;

/** GET /api/info, shared by every page and fetched once per page load. */
export function useApiInfo(): { info: ApiInfo | null; error: string | null } {
  const [info, setInfo] = useState<ApiInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    infoRequest ??= getInfo();
    let alive = true;
    infoRequest
      .then((value) => alive && setInfo(value))
      .catch((reason: Error) => {
        infoRequest = null;
        if (alive) setError(`Cannot reach the server: ${reason.message}`);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { info, error };
}

/** The curated sample cases. The server can be slow to answer while it is busy segmenting, so retry a few times. */
export function useSamples(): { samples: SampleCase[]; loaded: boolean } {
  const [samples, setSamples] = useState<SampleCase[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = (attempt: number) =>
      listSamples()
        .then((list) => {
          if (cancelled) return;
          setSamples(list);
          setLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 5) setTimeout(() => load(attempt + 1), 2000 * (attempt + 1));
          else setLoaded(true);
        });
    void load(0);
    return () => {
      cancelled = true;
    };
  }, []);
  return { samples, loaded };
}

const LAST_JOB_KEY = "glioma.lastJob";

export function lastJob(): string | null {
  try {
    return window.localStorage.getItem(LAST_JOB_KEY);
  } catch {
    return null;
  }
}

export function rememberJob(jobId: string | null): void {
  try {
    if (jobId) window.localStorage.setItem(LAST_JOB_KEY, jobId);
    else window.localStorage.removeItem(LAST_JOB_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** "PatientID_0009_Timepoint_2" → "Patient 0009 · timepoint 2". */
export function caseLabel(caseId: string | null | undefined): string {
  if (!caseId) return "";
  const match = /PatientID_(\w+?)_Timepoint_(\w+)/.exec(caseId);
  return match ? `Patient ${match[1]} · timepoint ${match[2]}` : caseId.replace(/_/g, " ");
}

export const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
