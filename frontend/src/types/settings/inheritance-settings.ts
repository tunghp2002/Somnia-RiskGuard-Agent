export type BeneficiaryDraft = {
  id: number;
  address: string;
  sharePercent: number;
  locked: boolean;
};

export type TokenDraft = {
  address: string;
  symbol: string;
  decimals: string;
};

export type DurationDraft = {
  days: string;
  hours: string;
};

export type AllocationSegment = {
  color: string;
  id: number;
  offset: number;
  rest: number;
  share: number;
};
