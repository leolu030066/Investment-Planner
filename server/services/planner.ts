import { randomUUID } from "node:crypto";
import {
  AppState,
  Currency,
  GoalType,
  HoldingOverview,
  InvestmentOperation,
  MonthOverview,
  MonthStatus,
  OperationSnapshot,
  OverviewState,
  PlannerWarning,
  SettingsState,
  StockOverview,
  TimeSlot
} from "../types.js";

const EPSILON = 0.000001;

interface MonthStockBucket {
  stockName: string;
  currency: Currency;
  goalType: GoalType;
  target: number;
  actual: number;
}

type MonthBuckets = Map<string, Map<string, MonthStockBucket>>;

export function makeId() {
  return randomUUID();
}

export function stockKey(stockName: string, currency: Currency) {
  return `${stockName.trim().toUpperCase()}__${currency}`;
}

export function goalKey(stockName: string, currency: Currency, goalType: GoalType) {
  return `${stockKey(stockName, currency)}__${goalType}`;
}

export function normalizeStockName(stockName: string) {
  return stockName.trim().toUpperCase();
}

export function getTaiwanTodayParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day)
  };
}

export function getTaiwanToday(date = new Date()) {
  const parts = getTaiwanTodayParts(date);
  return `${parts.year}/${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")}`;
}

export function getTaiwanCurrentMonth(date = new Date()) {
  const parts = getTaiwanTodayParts(date);
  return `${parts.year}/${String(parts.month).padStart(2, "0")}`;
}

export function parseMonth(month: string) {
  const [year, monthPart] = month.split("/").map(Number);
  return year * 12 + monthPart - 1;
}

export function formatMonth(monthIndex: number) {
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}/${String(month).padStart(2, "0")}`;
}

export function monthFromDate(date: string) {
  const [year, month] = date.split("/");
  return `${year}/${month}`;
}

export function addMonths(month: string, amount: number) {
  return formatMonth(parseMonth(month) + amount);
}

export function monthRange(startMonth: string, endMonth: string) {
  const start = parseMonth(startMonth);
  const end = parseMonth(endMonth);
  const months: string[] = [];

  for (let month = start; month <= end; month += 1) {
    months.push(formatMonth(month));
  }

  return months;
}

export function createDefaultSettings(date = new Date()): SettingsState {
  const startMonth = getTaiwanCurrentMonth(date);
  const endMonth = addMonths(startMonth, 11);

  return {
    timeSlots: [
      {
        id: makeId(),
        startMonth,
        endMonth,
        stocks: [
          { id: makeId(), stockName: "TQQQ", goalType: "BUY", monthlyGoal: 1270, currency: "USD" },
          { id: makeId(), stockName: "UPRO", goalType: "BUY", monthlyGoal: 1270, currency: "USD" },
          { id: makeId(), stockName: "VT", goalType: "BUY", monthlyGoal: 317.5, currency: "USD" },
          { id: makeId(), stockName: "0050", goalType: "BUY", monthlyGoal: 10000, currency: "TWD" }
        ]
      }
    ]
  };
}

export function snapshotOperation(operation: InvestmentOperation): OperationSnapshot {
  return {
    type: operation.type,
    stockName: operation.stockName,
    currency: operation.currency,
    amount: operation.amount,
    price: operation.price,
    quantity: operation.quantity,
    splitFrom: operation.splitFrom,
    splitTo: operation.splitTo,
    date: operation.date,
    note: operation.note,
    status: operation.status,
    savedAt: new Date().toISOString()
  };
}

export function normalizeSettings(settings: SettingsState): SettingsState {
  return {
    ...settings,
    timeSlots: settings.timeSlots
      .map((slot) => ({
        ...slot,
        id: slot.id || makeId(),
        stocks: slot.stocks.map((stock) => ({
          ...stock,
          id: stock.id || makeId(),
          stockName: normalizeStockName(stock.stockName),
          goalType: stock.goalType ?? "BUY"
        }))
      }))
      .sort((a, b) => parseMonth(a.startMonth) - parseMonth(b.startMonth))
  };
}

export function buildAvailableStocks(settings: SettingsState) {
  const stocks = new Map<string, { stockName: string; currency: Currency }>();

  settings.timeSlots.forEach((slot) => {
    slot.stocks.forEach((stock) => {
      stocks.set(stockKey(stock.stockName, stock.currency), {
        stockName: normalizeStockName(stock.stockName),
        currency: stock.currency
      });
    });
  });

  return Array.from(stocks.values()).sort((a, b) => {
    if (a.stockName === b.stockName) return a.currency.localeCompare(b.currency);
    return a.stockName.localeCompare(b.stockName);
  });
}

function buildSchedule(settings: SettingsState): MonthBuckets {
  const buckets: MonthBuckets = new Map();

  settings.timeSlots.forEach((slot) => {
    monthRange(slot.startMonth, slot.endMonth).forEach((month) => {
      if (!buckets.has(month)) buckets.set(month, new Map());
      const monthBucket = buckets.get(month)!;

      slot.stocks.forEach((stock) => {
        const key = goalKey(stock.stockName, stock.currency, stock.goalType);
        const existing = monthBucket.get(key);

        if (existing) {
          existing.target += stock.monthlyGoal;
        } else {
          monthBucket.set(key, {
            stockName: normalizeStockName(stock.stockName),
            currency: stock.currency,
            goalType: stock.goalType,
            target: stock.monthlyGoal,
            actual: 0
          });
        }
      });
    });
  });

  return buckets;
}

function monthsForStock(schedule: MonthBuckets, key: string) {
  return Array.from(schedule.entries())
    .filter(([, stocks]) => stocks.has(key))
    .map(([month]) => month)
    .sort((a, b) => parseMonth(a) - parseMonth(b));
}

function roundMoney(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function roundQuantity(quantity: number) {
  return Math.round((quantity + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function allocateGoalForward(schedule: MonthBuckets, operation: InvestmentOperation, goalType: GoalType) {
  const key = goalKey(operation.stockName, operation.currency, goalType);
  const operationMonthIndex = parseMonth(monthFromDate(operation.date));
  const allMonths = monthsForStock(schedule, key);
  let eligibleMonths = allMonths.filter((month) => parseMonth(month) >= operationMonthIndex);

  if (eligibleMonths.length === 0 && allMonths.length > 0) {
    eligibleMonths = [allMonths[allMonths.length - 1]];
  }

  if (eligibleMonths.length === 0) return;

  let remaining = operation.amount;

  eligibleMonths.forEach((month) => {
    if (remaining <= EPSILON) return;
    const bucket = schedule.get(month)?.get(key);
    if (!bucket) return;

    const need = Math.max(bucket.target - bucket.actual, 0);
    const applied = Math.min(remaining, need);
    bucket.actual += applied;
    remaining -= applied;
  });

  if (remaining > EPSILON) {
    const lastMonth = eligibleMonths[eligibleMonths.length - 1];
    const bucket = schedule.get(lastMonth)?.get(key);
    if (bucket) bucket.actual += remaining;
  }
}

function allocatedAmountForStock(schedule: MonthBuckets, key: string) {
  return monthsForStock(schedule, key).reduce((total, month) => {
    return total + (schedule.get(month)?.get(key)?.actual ?? 0);
  }, 0);
}

function reduceBuyGoalForSell(schedule: MonthBuckets, operation: InvestmentOperation, warnings: PlannerWarning[]) {
  const key = goalKey(operation.stockName, operation.currency, "BUY");
  const months = monthsForStock(schedule, key).sort((a, b) => parseMonth(b) - parseMonth(a));

  if (months.length === 0) return;

  const totalAllocated = allocatedAmountForStock(schedule, key);

  if (totalAllocated + EPSILON < operation.amount) {
    warnings.push({
      operationId: operation.id,
      message: `${operation.date} ${operation.stockName} 賣出金額超過目前已累積投資金額，已略過這筆 Sell。`
    });
    return;
  }

  let remaining = operation.amount;

  months.forEach((month) => {
    if (remaining <= EPSILON) return;
    const bucket = schedule.get(month)?.get(key);
    if (!bucket || bucket.actual <= EPSILON) return;

    const deducted = Math.min(remaining, bucket.actual);
    bucket.actual -= deducted;
    remaining -= deducted;
  });
}

function splitRatio(operation: InvestmentOperation) {
  if (!operation.splitFrom || !operation.splitTo || operation.splitFrom <= EPSILON || operation.splitTo <= EPSILON) return null;
  return operation.splitTo / operation.splitFrom;
}

function buildHoldings(operations: InvestmentOperation[], warnings: PlannerWarning[]) {
  const holdings = new Map<string, HoldingOverview>();

  operations.forEach((operation) => {
    const key = stockKey(operation.stockName, operation.currency);
    const current = holdings.get(key) ?? {
      stockName: normalizeStockName(operation.stockName),
      currency: operation.currency,
      quantity: 0
    };

    if (operation.type === "BUY") {
      current.quantity += operation.quantity;
    } else if (operation.type === "SELL") {
      if (current.quantity + EPSILON < operation.quantity) {
        warnings.push({
          operationId: operation.id,
          message: `${operation.date} ${operation.stockName} 賣出股數超過目前持有股數，已略過這筆 Sell。`
        });
      } else {
        current.quantity -= operation.quantity;
      }
    } else if (operation.type === "SPLIT") {
      const ratio = splitRatio(operation);

      if (!ratio) {
        warnings.push({
          operationId: operation.id,
          message: `${operation.date} ${operation.stockName} Split 比例無效，已略過這筆 Split。`
        });
      } else {
        current.quantity *= ratio;
      }
    }

    holdings.set(key, current);
  });

  return Array.from(holdings.values())
    .filter((holding) => holding.quantity > EPSILON)
    .map((holding) => ({ ...holding, quantity: roundQuantity(holding.quantity) }))
    .sort((a, b) => {
      if (a.stockName === b.stockName) return a.currency.localeCompare(b.currency);
      return a.stockName.localeCompare(b.stockName);
    });
}

function getStockStatus(month: string, target: number, actual: number, currentMonth: string): MonthStatus {
  if (actual + EPSILON >= target) return "complete";
  return parseMonth(month) < parseMonth(currentMonth) ? "failed" : "pending";
}

function buildMonths(schedule: MonthBuckets, currentMonth: string): MonthOverview[] {
  return Array.from(schedule.entries())
    .sort(([a], [b]) => parseMonth(a) - parseMonth(b))
    .map(([month, stocks]) => {
      const stockRows: StockOverview[] = Array.from(stocks.values())
        .map((stock) => ({
          stockName: stock.stockName,
          currency: stock.currency,
          goalType: stock.goalType,
          target: roundMoney(stock.target),
          actual: roundMoney(stock.actual),
          status: getStockStatus(month, stock.target, stock.actual, currentMonth)
        }))
        .sort((a, b) => {
          if (a.stockName !== b.stockName) return a.stockName.localeCompare(b.stockName);
          if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
          return a.goalType.localeCompare(b.goalType);
        });

      const totals = Array.from(
        stockRows.reduce((map, stock) => {
          const current = map.get(stock.currency) ?? { currency: stock.currency, target: 0, actual: 0 };
          current.target += stock.target;
          current.actual += stock.actual;
          map.set(stock.currency, current);
          return map;
        }, new Map<Currency, { currency: Currency; target: number; actual: number }>())
      )
        .map(([, total]) => ({
          ...total,
          target: roundMoney(total.target),
          actual: roundMoney(total.actual)
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency));

      const allComplete = stockRows.every((stock) => stock.status === "complete");
      const status: MonthStatus = allComplete
        ? "complete"
        : parseMonth(month) < parseMonth(currentMonth)
          ? "failed"
          : "pending";

      return {
        month,
        status,
        totals,
        stocks: stockRows
      };
    });
}

export function calculateOverview(
  settingsInput: SettingsState,
  operationsInput: InvestmentOperation[],
  date = new Date()
): OverviewState {
  const settings = normalizeSettings(settingsInput);
  const schedule = buildSchedule(settings);
  const warnings: PlannerWarning[] = [];
  const currentMonth = getTaiwanCurrentMonth(date);
  const activeOperations = operationsInput
    .filter((operation) => operation.status === "active")
    .map((operation) => ({
      ...operation,
      stockName: normalizeStockName(operation.stockName)
    }))
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.createdAt.localeCompare(b.createdAt);
    });

  const holdings = buildHoldings(activeOperations, warnings);

  activeOperations.forEach((operation) => {
    if (warnings.some((warning) => warning.operationId === operation.id)) return;

    if (operation.type === "BUY") {
      allocateGoalForward(schedule, operation, "BUY");
    } else if (operation.type === "SELL") {
      reduceBuyGoalForSell(schedule, operation, warnings);

      if (!warnings.some((warning) => warning.operationId === operation.id)) {
        allocateGoalForward(schedule, operation, "SELL");
      }
    }
  });

  return {
    currentMonth,
    holdings,
    months: buildMonths(schedule, currentMonth),
    warnings
  };
}

export function buildAppState(settings: SettingsState, operations: InvestmentOperation[]): AppState {
  return {
    settings: normalizeSettings(settings),
    operations: operations
      .map((operation) => ({
        ...operation,
        stockName: normalizeStockName(operation.stockName)
      }))
      .sort((a, b) => {
        const byDate = b.date.localeCompare(a.date);
        if (byDate !== 0) return byDate;
        return b.createdAt.localeCompare(a.createdAt);
      }),
    overview: calculateOverview(settings, operations)
  };
}

export function hasInvalidWarnings(overview: OverviewState) {
  return overview.warnings.length > 0;
}
