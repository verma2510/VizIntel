import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useData, useDataset } from "../context/Data";
import { getPrepared, type PreparedDataset } from "../lib/data/prepare";

/**
 * Resolves the dataset a page is about: the `:id` route param, else the most recent dataset (the URL is
 * updated so the view is shareable/bookmarkable). Loads its rows and returns the prepared view.
 */
export function useActiveDataset(basePath: string) {
  const { id } = useParams<{ id: string }>();
  const { datasets, status } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const fallback = datasets[0]?._id;

  useEffect(() => {
    if (!id && fallback) navigate(`${basePath}/${fallback}${location.search}${location.hash}`, { replace: true });
  }, [id, fallback, basePath, navigate, location.search, location.hash]);

  const activeId = id ?? fallback;
  const { dataset, meta, loading, error, retry } = useDataset(activeId);
  const prepared: PreparedDataset | null = useMemo(() => (dataset?.originalData ? getPrepared(dataset) : null), [dataset]);

  return {
    id: activeId,
    dataset,
    meta,
    prepared,
    loading,
    error,
    retry,
    listStatus: status,
    notFound: Boolean(id) && status === "ready" && !meta && Boolean(error),
    hasDatasets: datasets.length > 0,
    select: (next: string) => navigate(`${basePath}/${next}`),
  };
}
