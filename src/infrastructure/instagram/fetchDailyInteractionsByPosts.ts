import axios from "axios";
import type { AxiosResponse } from "axios";
import { parseYmd, ymd } from "../../presentation/http/instagram/instagramDateUtils";
import { toFiniteNumber } from "../../presentation/http/instagram/instagramInsightsMapper";

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
  const toTs = parseYmd(to).getTime() + 86399999;

  const allMedia: IgMediaItem[] = [];
  let after: string | undefined = undefined;

  for (let guard = 0; guard < 30; guard++) {
    const mediaRes: AxiosResponse<IgMediaResponse> =
      await graph.get<IgMediaResponse>(`/${igUserId}/media`, {
        params: {
          fields: "id,timestamp,like_count,comments_count",
          limit: 100,
          after,
          access_token: accessToken,
        },
      });

    const data = mediaRes.data?.data ?? [];
    allMedia.push(...data);

    const nextAfter = mediaRes.data?.paging?.cursors?.after;
    if (!nextAfter) break;
    after = nextAfter;

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

  const add = (map: Record<string, number>, day: string, v: number) => {
    map[day] = (map[day] ?? 0) + (Number.isFinite(v) ? v : 0);
  };

  for (const m of inRange) {
    const day = ymd(new Date(m.timestamp));
    const likes = toFiniteNumber(m.like_count);
    const comments = toFiniteNumber(m.comments_count);

    add(likesByDay, day, likes);
    add(commentsByDay, day, comments);
    add(totalByDay, day, likes + comments);
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

      add(sharesByDay, day, shares);
      add(savesByDay, day, saved);
      add(totalByDay, day, shares + saved);
    } catch {
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
