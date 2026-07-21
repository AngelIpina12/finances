export interface SimulationEvent {
  type: "expense" | "income";
  accountId: string;
  accountName: string;
  paymentName: string;
  amount: number;
  date: Date;
}

export interface BalanceDataPoint {
  date: Date;
  balance: number;
}

export interface AccountProjection {
  accountId: string;
  accountName: string;
  initialBalance: number;
  currency: string;
  dataPoints: BalanceDataPoint[];
  events: SimulationEvent[];
}

export type SimulationPeriod = "30days" | "90days" | "12months";

export interface SimulationResult {
  accountProjections: AccountProjection[];
  totalBalanceDataPoints: BalanceDataPoint[];
  simulationRange: {
    start: Date;
    end: Date;
  };
  periodLabel: "30 days" | "90 days" | "12 months";
}
