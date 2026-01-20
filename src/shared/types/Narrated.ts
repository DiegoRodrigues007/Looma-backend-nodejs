export type NarratedItem = {
  headline: string;
  text: string;
  action: string;
  confidence: "low" | "medium" | "high";
  evidence: Array<{ label: string; value: number | string }>;
};

export type Narrated = {
  why: NarratedItem[];
  improve: NarratedItem[];
  continue: NarratedItem[];
};
