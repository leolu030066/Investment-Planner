export type Currency = "USD" | "TWD";
export type OperationType = "BUY" | "SELL" | "SPLIT";
export type OperationStatus = "active" | "deleted";
export type MonthStatus = "complete" | "pending" | "failed";

export interface StockSetting {
  id: string;
  stockName: string;
  monthlyGoal: number;
  currency: Currency;
}

export interface TimeSlot {
  id: string;
  startMonth: string;
  endMonth: string;
  stocks: StockSetting[];
}

export interface SettingsState {
  id?: string;
  timeSlots: TimeSlot[];
}

export interface OperationSnapshot {
  type: OperationType;
  stockName: string;
  currency: Currency;
  amount: number;
  price: number;
  quantity: number;
  splitFrom?: number;
  splitTo?: number;
  date: string;
  note: string;
  status: OperationStatus;
  savedAt: string;
}

export interface InvestmentOperation {
  id: string;
  type: OperationType;
  stockName: string;
  currency: Currency;
  amount: number;
  price: number;
  quantity: number;
  splitFrom?: number;
  splitTo?: number;
  date: string;
  note: string;
  status: OperationStatus;
  history: OperationSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface StockOverview {
  stockName: string;
  currency: Currency;
  target: number;
  actual: number;
  status: MonthStatus;
}

export interface CurrencyTotal {
  currency: Currency;
  target: number;
  actual: number;
}

export interface MonthOverview {
  month: string;
  status: MonthStatus;
  totals: CurrencyTotal[];
  stocks: StockOverview[];
}

export interface HoldingOverview {
  stockName: string;
  currency: Currency;
  quantity: number;
}

export interface PlannerWarning {
  operationId: string;
  message: string;
}

export interface OverviewState {
  currentMonth: string;
  holdings: HoldingOverview[];
  months: MonthOverview[];
  warnings: PlannerWarning[];
}

export interface AppState {
  settings: SettingsState;
  operations: InvestmentOperation[];
  overview: OverviewState;
}
