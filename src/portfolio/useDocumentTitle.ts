import { useEffect } from 'react';

const SITE = 'Cassidy’s Creative Universe';

export function useDocumentTitle(page?: string) {
  useEffect(() => {
    document.title = page ? `${page} · ${SITE}` : SITE;
  }, [page]);
}
