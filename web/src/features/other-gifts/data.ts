// Other gifts: one hook per route, with the schema each answer must match. Writes go through send() and refresh the lists they change.
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { api, ApiError, send } from '@/lib/api';
import { hubGet } from '../../lib/hub';
import { ogBatchDetail, ogIndex, ogLastCoding, ogList, ogPartnerHits, ogRecommenders, type OgBatchDetail } from '@shared/schemas';

export const ogKeys = {
  index: ['og', 'index'] as const,
  list: (tab: string, term: string, page: number, size: number) => ['og', 'list', tab, term, page, size] as const,
  batch: (id: string) => ['og', 'batch', id] as const,
};

// Reads go through hubGet (the server reads /api with the visitor's cookie while the page renders, the browser reads it the usual way) and
// are drawn with useSuspenseQuery inside Suspense, so the server's HTML and the browser's first render agree.
export const ogIndexQuery = queryOptions({ queryKey: ogKeys.index, queryFn: async () => ogIndex.parse(await hubGet('/api/other-gifts')), staleTime: 15_000 });

export const ogListQuery = (tab: string, term: string, page: number, size: number) =>
  queryOptions({
    queryKey: ogKeys.list(tab, term, page, size),
    queryFn: async () => ogList.parse(await hubGet(`/api/other-gifts/list?tab=${encodeURIComponent(tab)}&q=${encodeURIComponent(term)}&page=${page}&size=${size}`)),
    staleTime: 15_000,
  });

/** A batch in full. While it is posting the page asks again every few seconds so the approver watches it finish. */
export const ogBatchQuery = (id: string) =>
  queryOptions({
    queryKey: ogKeys.batch(id),
    queryFn: async () => ogBatchDetail.parse(await hubGet(`/api/other-gifts/batches/${id}`)),
    refetchInterval: (q) => (q.state.data && q.state.data.batch.status === 'posting' ? 3000 : false),
  });

export const useOgIndex = () => useSuspenseQuery(ogIndexQuery);
export const useOgList = (tab: string, term: string, page: number, size: number) => useSuspenseQuery(ogListQuery(tab, term, page, size));
export const useOgBatch = (id: string) => useSuspenseQuery(ogBatchQuery(id));

export async function searchPartners(term: string): Promise<{ cid: string; lookup: string; name: string; place: string }[]> {
  const r = await api(`/api/gift-entry/partners?q=${encodeURIComponent(term)}`, ogPartnerHits);
  return r.hits;
}

export async function lastCoding(partnerId: string) {
  const r = await api(`/api/gift-entry/partners?coding=${encodeURIComponent(partnerId)}`, ogLastCoding);
  return r.last;
}

export async function recommenders(sponsor: string, term: string) {
  const r = await api(`/api/other-gifts/recommenders?sponsor=${encodeURIComponent(sponsor)}&q=${encodeURIComponent(term)}`, ogRecommenders);
  return r.rows;
}

/** The letter goes up as the raw file. Content-Type is its type and X-File-Name its name. */
export async function uploadLetter(giftId: string, file: File): Promise<void> {
  const res = await fetch(`/api/other-gifts/gifts/${giftId}/letter`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'X-Hub-Request': '1', 'Content-Type': file.type || 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || !data || data.ok === false) throw new ApiError((data && data.message) || 'The letter did not upload. Try again.', res.status);
}

export function useOgActions() {
  const qc = useQueryClient();
  const refresh = (batchId?: string) => {
    void qc.invalidateQueries({ queryKey: ['og'] });
    if (batchId) void qc.invalidateQueries({ queryKey: ogKeys.batch(batchId) });
  };
  const run = (path: string, body?: unknown, method: 'POST' | 'PATCH' | 'DELETE' | 'PUT' = 'POST') => send(path, body, method) as Promise<Record<string, unknown>>;
  return {
    refresh,
    saveGift: useMutation({
      mutationFn: async (v: { kind: string; set: Record<string, unknown>; file?: File | null }) => {
        const r = (await run('/api/other-gifts/gifts', { kind: v.kind, set: v.set })) as unknown as OgBatchDetail & { gift: { id: string } };
        if (v.file) await uploadLetter(r.gift.id, v.file);
        return r;
      },
      onSuccess: (r) => refresh(r.batch.id),
    }),
    editGift: useMutation({
      mutationFn: async (v: { id: string; set?: Record<string, unknown>; dupDecision?: string; file?: File | null }) => {
        const r = (await run(`/api/other-gifts/gifts/${v.id}`, { set: v.set, dupDecision: v.dupDecision }, 'PATCH')) as unknown as OgBatchDetail;
        if (v.file) await uploadLetter(v.id, v.file);
        return r;
      },
      onSuccess: (r) => refresh(r.batch.id),
    }),
    removeGift: useMutation({ mutationFn: (id: string) => run(`/api/other-gifts/gifts/${id}`, undefined, 'DELETE'), onSuccess: () => refresh() }),
    dropLetter: useMutation({ mutationFn: (id: string) => run(`/api/other-gifts/gifts/${id}/letter`, undefined, 'DELETE'), onSuccess: () => refresh() }),
    step: useMutation({
      mutationFn: (v: { id: string; action: 'submit' | 'withdraw' | 'approve' | 'retry' | 'remove' }) => run(`/api/other-gifts/batches/${v.id}/${v.action}`),
      onSuccess: (_r, v) => refresh(v.id),
    }),
  };
}
