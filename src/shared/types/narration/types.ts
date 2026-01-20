export type NarrationConfidence = "low" | "medium" | "high";

export type NarratedItem = {
  headline: string;
  text: string;
  action: string;
  confidence: NarrationConfidence;
  evidence: Array<{ label: string; value: number | string }>;
};

export type Narrated = {
  why: NarratedItem[];
  improve: NarratedItem[];
  continue: NarratedItem[];
};
