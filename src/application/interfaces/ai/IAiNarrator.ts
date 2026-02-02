
export interface IAiNarrator<TInput, TOutput> {
  narrate(input: TInput): Promise<TOutput>;
}
