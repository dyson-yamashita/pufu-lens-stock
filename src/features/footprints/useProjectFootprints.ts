import { useCallback, useEffect, useRef, useState } from 'react';
import type { FootprintPoint } from '../../../shared/footprints';
import { api, send } from '../../lib/api';

const emptyPoints: FootprintPoint[] = [];

export function useProjectFootprints(
  projectId: string | undefined,
  showTimeline: boolean,
  memoryRevision?: number,
) {
  const [snapshot, setSnapshot] = useState<{
    projectId: string;
    pending: boolean | null;
    points?: FootprintPoint[];
  } | null>(null);
  const [submittingProjects, setSubmittingProjects] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const requestVersion = useRef(0);
  const endpoint = projectId
    ? `/api/v1/projects/${encodeURIComponent(projectId)}/footprints`
    : null;
  const current = snapshot?.projectId === projectId ? snapshot : null;
  const submitting = projectId !== undefined && submittingProjects.includes(projectId);

  useEffect(() => {
    if (!projectId || !endpoint) return;
    const controller = new AbortController();
    let loading = false;
    let loadedTimeline = false;
    let pending = false;
    let timer: number | undefined;

    const load = async () => {
      if (loading) return;
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      loading = true;
      const version = requestVersion.current;
      try {
        const status = await api<{ pending: boolean; points?: FootprintPoint[] }>(
          showTimeline && (!loadedTimeline || pending) ? endpoint : `${endpoint}?status_only=1`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || requestVersion.current !== version) return;
        pending = status.pending;
        loadedTimeline ||= status.points !== undefined;
        setSnapshot((current) => {
          const points = showTimeline
            ? (status.points ?? (current?.projectId === projectId ? current.points : undefined))
            : undefined;
          if (
            current?.projectId === projectId &&
            JSON.stringify(current.points) === JSON.stringify(points)
          ) {
            return current.pending === status.pending
              ? current
              : { ...current, pending: status.pending };
          }
          return { projectId, pending: status.pending, points };
        });
      } catch {
        // Keep the last known status while the next poll retries.
      } finally {
        loading = false;
        if (!controller.signal.aborted) timer = window.setTimeout(load, 5000);
      }
    };

    const refreshOnVisibility = () => {
      loadedTimeline = false;
      void load();
    };
    void load();
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [projectId, endpoint, showTimeline, memoryRevision, refresh]);

  async function startBackfill() {
    if (!projectId || !endpoint || current?.pending !== false || submitting) return;
    setSubmittingProjects((projects) => [...projects, projectId]);
    let accepted = false;
    try {
      await send(`${endpoint}/backfill`);
      accepted = true;
    } finally {
      requestVersion.current++;
      setSnapshot((current) =>
        current?.projectId === projectId
          ? { ...current, pending: accepted || current.pending === true ? true : null }
          : current,
      );
      setSubmittingProjects((projects) => projects.filter((id) => id !== projectId));
      setRefresh((current) => current + 1);
    }
  }

  const updatePointKind = useCallback(
    (revision: number, kind: FootprintPoint['kind']) => {
      setSnapshot((current) => {
        if (
          current?.projectId !== projectId ||
          !current?.points?.some((point) => point.revision === revision && point.kind !== kind)
        )
          return current;
        return {
          ...current,
          points: current.points.map((point) =>
            point.revision === revision ? { ...point, kind } : point,
          ),
        };
      });
    },
    [projectId],
  );

  return {
    points: current?.points ?? emptyPoints,
    pending: current?.pending ?? null,
    startBackfill,
    submitting,
    updatePointKind,
  };
}
