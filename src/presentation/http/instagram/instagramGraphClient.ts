import axios, { AxiosResponse } from "axios";

type IgMediaItem = {
  id: string;
  timestamp: string;
  like_count?: number | string;
  comments_count?: number | string;
};

type IgMediaResponse = {
  data: IgMediaItem[];
};

export async function fetchUserMedia(
  igUserId: string,
  accessToken: string
): Promise<IgMediaItem[]> {
  const res: AxiosResponse<IgMediaResponse> = await axios.get(
    `https://graph.facebook.com/v21.0/${igUserId}/media`,
    {
      params: {
        fields: "id,timestamp,like_count,comments_count",
        access_token: accessToken,
      },
    }
  );

  return res.data.data ?? [];
}

export async function fetchInsights(
  mediaId: string,
  metrics: string[],
  accessToken: string
) {
  const res = await axios.get(
    `https://graph.facebook.com/v21.0/${mediaId}/insights`,
    {
      params: {
        metric: metrics.join(","),
        access_token: accessToken,
      },
    }
  );

  return res.data?.data ?? [];
}
