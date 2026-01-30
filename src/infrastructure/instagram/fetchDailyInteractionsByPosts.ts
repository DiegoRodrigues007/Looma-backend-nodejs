import axios from "axios";
import type { AxiosResponse } from "axios";
import { parseYmd, ymd } from "../../shared/date/instagramDateUtils";
import { toFiniteNumber } from "../../domain/metrics/instagram/instagramInsightsMapper";
import {
  addByDay,
  sumInteractions,
} from "../../domain/metrics/calculators/dailyAggregators";

type IgMediaItem = {
  id: string;
  timestamp: string;
  like_count?: number | string;
  comments_count?: number | string;
};

type IgMediaResponse = {
  data: IgMediaItem[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
};

type IgInsightRow = {
  name?: string;
  values?: Array<{ value?: any }>;
  value?: any;
  total_value?: any;
};

type IgInsightsResponse = {
  data: IgInsightRow[];
};

async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing = new Set<Promise<any>>();

  for (let i = 0; i < array.length; i++) {
    const p = Promise.resolve().then(() => iteratorFn(array[i], i));
    ret.push(p);

    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= poolLimit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

export async function fetchDailyInteractionsByPosts(opts: {
  igUserId: string;
  accessToken: string;
  from: string;
  to: string;
  graph: ReturnType<typeof axios.create>;
}) {
  const { igUserId, accessToken, from, to, graph } = opts;

  const fromTs = parseYmd(from).getTime();
  const toTs = parseYmd(to).getTime() + 86_399_999; // fim do dia

  const allMedia: IgMediaItem[] = [];
  let after: string | undefined = undefined;

  // ✅ era 30 e quebrava STRESS (50 páginas). Agora suporta bem mais e ainda tem guard.
  const MAX_PAGES = 500;

  for (let guard = 0; guard < MAX_PAGES; guard++) {
    const params: any = {
      fields: "id,timestamp,like_count,comments_count",
      limit: 100,
      access_token: accessToken,
    };
    if (after) params.after = after;

    const mediaRes: AxiosResponse<IgMediaResponse> =
      await graph.get<IgMediaResponse>(`/${igUserId}/media`, { params });

    const data = mediaRes.data?.data ?? [];

    // ✅ se a API/mock devolver vazio, não tem por que continuar
    if (data.length === 0) break;

    allMedia.push(...data);

    const nextAfter = mediaRes.data?.paging?.cursors?.after;
    if (!nextAfter) break;
    after = nextAfter;

    // ✅ otimização: se o último post da página já é mais velho que o from, podemos parar
    const oldest = data[data.length - 1]?.timestamp;
    if (oldest) {
      const oldestTs = new Date(oldest).getTime();
      if (oldestTs < fromTs) break;
    }
  }

  const inRange = allMedia.filter((m) => {
    const ts = new Date(m.timestamp).getTime();
    return ts >= fromTs && ts <= toTs;
  });

  const likesByDay: Record<string, number> = {};
  const commentsByDay: Record<string, number> = {};
  const sharesByDay: Record<string, number> = {};
  const savesByDay: Record<string, number> = {};
  const totalByDay: Record<string, number> = {};

  for (const m of inRange) {
    const day = ymd(new Date(m.timestamp));
    const likes = toFiniteNumber(m.like_count);
    const comments = toFiniteNumber(m.comments_count);

    addByDay(likesByDay, day, likes);
    addByDay(commentsByDay, day, comments);

    addByDay(totalByDay, day, sumInteractions({ likes, comments }));
  }

  await asyncPool(6, inRange, async (m) => {
    try {
      const insightsRes: AxiosResponse<IgInsightsResponse> =
        await graph.get<IgInsightsResponse>(`/${m.id}/insights`, {
          params: {
            metric: "shares,saved",
            access_token: accessToken,
          },
        });

      const arr = insightsRes.data?.data ?? [];

      const pickValue = (row: IgInsightRow): number => {
        const v =
          row?.values?.[0]?.value ??
          row?.total_value ??
          row?.value ??
          row ??
          0;
        return toFiniteNumber(v);
      };

      const map: Record<string, number> = {};
      for (const r of arr) {
        const name = String(r?.name ?? "");
        map[name] = pickValue(r);
      }

      const shares = toFiniteNumber(map.shares);
      const saved = toFiniteNumber(map.saved);
      const day = ymd(new Date(m.timestamp));

      addByDay(sharesByDay, day, shares);
      addByDay(savesByDay, day, saved);

      addByDay(totalByDay, day, sumInteractions({ shares, saved }));
    } catch {
      // mantém silencioso para não falhar em caso de limitação/erro do Graph
    }
  });

  return {
    likesByDay,
    commentsByDay,
    sharesByDay,
    savesByDay,
    totalByDay,
  };
}
