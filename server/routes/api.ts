import { Router } from "express";
import { z } from "zod";
import { OperationModel } from "../models/Operation.js";
import { SettingModel } from "../models/Setting.js";
import {
  buildAppState,
  calculateOverview,
  createDefaultSettings,
  hasInvalidWarnings,
  makeId,
  normalizeSettings,
  normalizeStockName,
  parseMonth,
  snapshotOperation,
  stockKey
} from "../services/planner.js";
import { AppState, Currency, InvestmentOperation, SettingsState } from "../types.js";

const router = Router();

const monthSchema = z.string().regex(/^\d{4}\/(0[1-9]|1[0-2])$/, "Month must be YYYY/MM");
const dateSchema = z.string().regex(/^\d{4}\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/, "Date must be YYYY/MM/DD");
const currencySchema = z.enum(["USD", "TWD"]);

const stockSettingSchema = z.object({
  id: z.string().optional(),
  stockName: z.string().trim().min(1, "Stock name is required"),
  monthlyGoal: z.coerce.number().nonnegative("Monthly goal must be 0 or greater"),
  currency: currencySchema
});

const timeSlotSchema = z.object({
  id: z.string().optional(),
  startMonth: monthSchema,
  endMonth: monthSchema,
  stocks: z.array(stockSettingSchema).min(1, "At least one stock is required")
});

const settingsSchema = z.object({
  timeSlots: z.array(timeSlotSchema).min(1, "At least one time slot is required")
});

const operationSchema = z.object({
  type: z.enum(["BUY", "SELL"]),
  stockName: z.string().trim().min(1, "Stock is required"),
  currency: currencySchema,
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  price: z.coerce.number().positive("Price must be greater than 0"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  date: dateSchema,
  note: z.string().max(500).optional().default("")
});

class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return Array.from(new Set(error.issues.map((issue) => issue.message))).join(", ");
  }

  if (error instanceof Error) return error.message;
  return "Unknown server error";
}

function serializeSettings(doc: any): SettingsState {
  return {
    id: doc._id?.toString(),
    timeSlots: doc.timeSlots
  };
}

function serializeOperation(doc: any): InvestmentOperation {
  return {
    id: doc._id?.toString(),
    type: doc.type,
    stockName: doc.stockName,
    currency: doc.currency,
    amount: doc.amount,
    price: doc.price,
    quantity: doc.quantity,
    date: doc.date,
    note: doc.note ?? "",
    status: doc.status,
    history: doc.history ?? [],
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString()
  };
}

async function getOrCreateSettings() {
  let settings = await SettingModel.findOne({ key: "default" });

  if (!settings) {
    settings = await SettingModel.create({
      key: "default",
      ...createDefaultSettings()
    });
  }

  return settings;
}

async function loadOperations() {
  const operations = await OperationModel.find().sort({ date: -1, createdAt: -1 });
  return operations.map((operation) => serializeOperation(operation.toObject()));
}

async function getState(): Promise<AppState> {
  const settings = await getOrCreateSettings();
  const operations = await loadOperations();
  return buildAppState(serializeSettings(settings.toObject()), operations);
}

function parseSettings(input: unknown): SettingsState {
  const parsed = settingsSchema.parse(input);
  const settings = normalizeSettings({
    timeSlots: parsed.timeSlots.map((slot) => ({
      id: slot.id || makeId(),
      startMonth: slot.startMonth,
      endMonth: slot.endMonth,
      stocks: slot.stocks.map((stock) => ({
        id: stock.id || makeId(),
        stockName: normalizeStockName(stock.stockName),
        monthlyGoal: stock.monthlyGoal,
        currency: stock.currency
      }))
    }))
  });

  settings.timeSlots.forEach((slot) => {
    if (parseMonth(slot.startMonth) > parseMonth(slot.endMonth)) {
      throw new ApiError(400, `${slot.startMonth} cannot be after ${slot.endMonth}`);
    }

    const seen = new Set<string>();
    slot.stocks.forEach((stock) => {
      const key = stockKey(stock.stockName, stock.currency);
      if (seen.has(key)) {
        throw new ApiError(400, `${stock.stockName} ${stock.currency} is duplicated in one time slot`);
      }
      seen.add(key);
    });
  });

  return settings;
}

function parseOperation(input: unknown) {
  const parsed = operationSchema.parse(input);
  return {
    ...parsed,
    stockName: normalizeStockName(parsed.stockName),
    note: parsed.note.trim()
  };
}

function buildCandidateOperation(
  input: ReturnType<typeof parseOperation>,
  values?: Partial<InvestmentOperation>
): InvestmentOperation {
  const now = new Date().toISOString();

  return {
    id: values?.id ?? makeId(),
    type: input.type,
    stockName: input.stockName,
    currency: input.currency as Currency,
    amount: input.amount,
    price: input.price,
    quantity: input.quantity,
    date: input.date,
    note: input.note,
    status: values?.status ?? "active",
    history: values?.history ?? [],
    createdAt: values?.createdAt ?? now,
    updatedAt: now
  };
}

function assertSellIsValid(settings: SettingsState, operations: InvestmentOperation[], operationId: string) {
  const overview = calculateOverview(settings, operations);
  const operationWarnings = overview.warnings.filter((warning) => warning.operationId === operationId);

  if (operationWarnings.length > 0 || hasInvalidWarnings(overview)) {
    throw new ApiError(400, operationWarnings[0]?.message ?? overview.warnings[0]?.message ?? "Sell operation is invalid");
  }
}

router.get("/state", async (_req, res, next) => {
  try {
    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    const parsed = parseSettings(req.body);
    const settings = await getOrCreateSettings();

    settings.set("timeSlots", parsed.timeSlots);
    await settings.save();

    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

router.post("/operations", async (req, res, next) => {
  try {
    const input = parseOperation(req.body);
    const state = await getState();
    const candidate = buildCandidateOperation(input);

    if (candidate.type === "SELL") {
      assertSellIsValid(state.settings, [...state.operations, candidate], candidate.id);
    }

    await OperationModel.create({
      type: candidate.type,
      stockName: candidate.stockName,
      currency: candidate.currency,
      amount: candidate.amount,
      price: candidate.price,
      quantity: candidate.quantity,
      date: candidate.date,
      note: candidate.note,
      status: "active",
      history: []
    });

    res.status(201).json(await getState());
  } catch (error) {
    next(error);
  }
});

router.patch("/operations/:id", async (req, res, next) => {
  try {
    const input = parseOperation(req.body);
    const operation = await OperationModel.findById(req.params.id);

    if (!operation) throw new ApiError(404, "Operation not found");
    if (operation.status === "deleted") throw new ApiError(400, "Deleted operations must be restored before editing");

    const existing = serializeOperation(operation.toObject());
    const candidate = buildCandidateOperation(input, {
      id: existing.id,
      status: existing.status,
      history: existing.history,
      createdAt: existing.createdAt
    });

    if (candidate.type === "SELL") {
      const state = await getState();
      const operations = state.operations.map((item) => (item.id === existing.id ? candidate : item));
      assertSellIsValid(state.settings, operations, candidate.id);
    }

    operation.history.push(snapshotOperation(existing));
    operation.set({
      type: candidate.type,
      stockName: candidate.stockName,
      currency: candidate.currency,
      amount: candidate.amount,
      price: candidate.price,
      quantity: candidate.quantity,
      date: candidate.date,
      note: candidate.note
    });
    await operation.save();

    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

router.delete("/operations/:id", async (req, res, next) => {
  try {
    const operation = await OperationModel.findById(req.params.id);

    if (!operation) throw new ApiError(404, "Operation not found");

    if (operation.status !== "deleted") {
      operation.history.push(snapshotOperation(serializeOperation(operation.toObject())));
      operation.status = "deleted";
      await operation.save();
    }

    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

router.post("/operations/:id/undo", async (req, res, next) => {
  try {
    const operation = await OperationModel.findById(req.params.id);

    if (!operation) throw new ApiError(404, "Operation not found");
    if (!operation.history.length) throw new ApiError(400, "No previous version to restore");

    const previous = operation.history[operation.history.length - 1];
    operation.history.pop();
    operation.set({
      type: previous.type,
      stockName: previous.stockName,
      currency: previous.currency,
      amount: previous.amount,
      price: previous.price,
      quantity: previous.quantity,
      date: previous.date,
      note: previous.note,
      status: previous.status
    });
    await operation.save();

    res.json(await getState());
  } catch (error) {
    next(error);
  }
});

router.use((error: unknown, _req: any, res: any, _next: any) => {
  const statusCode = error instanceof ApiError ? error.statusCode : 500;
  res.status(statusCode).json({
    error: toErrorMessage(error)
  });
});

export default router;
