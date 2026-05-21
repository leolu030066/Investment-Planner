import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  History,
  Lock,
  LogOut,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { FormEvent, MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  createOperation,
  deleteOperation,
  fetchAuthStatus,
  fetchState,
  loginWithPassword,
  logout,
  saveSettings,
  undoOperation,
  updateOperation
} from "./api";
import {
  AppState,
  Currency,
  InvestmentOperation,
  MonthStatus,
  OperationFormValues,
  OperationType,
  SettingsState,
  StockSetting,
  TimeSlot
} from "./types";

interface StockOption {
  stockName: string;
  currency: Currency;
}

function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function stockKey(stockName: string, currency: Currency) {
  return `${stockName.trim().toUpperCase()}__${currency}`;
}

function normalizeStockName(stockName: string) {
  return stockName.trim().toUpperCase();
}

function todayTaiwan() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}/${lookup.month}/${lookup.day}`;
}

function currentTaiwanMonth() {
  return todayTaiwan().slice(0, 7);
}

function parseMonth(month: string) {
  const [year, monthPart] = month.split("/").map(Number);
  return year * 12 + monthPart - 1;
}

function formatMonth(monthIndex: number) {
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}/${String(month).padStart(2, "0")}`;
}

function addMonths(month: string, amount: number) {
  return formatMonth(parseMonth(month) + amount);
}

function getStockOptions(settings?: SettingsState): StockOption[] {
  if (!settings) return [];

  const stocks = new Map<string, StockOption>();
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

function formatMoney(value: number, currency: Currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "TWD" ? 0 : 2
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  }).format(value);
}

function formatTaiwanDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${lookup.year}/${lookup.month}/${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

function emptyForm(type: OperationType, option?: StockOption): OperationFormValues {
  return {
    type,
    stockName: option?.stockName ?? "",
    currency: option?.currency ?? "USD",
    amount: "",
    price: "",
    quantity: "",
    splitFrom: "1",
    splitTo: "2",
    date: todayTaiwan(),
    note: ""
  };
}

function formFromOperation(operation: InvestmentOperation): OperationFormValues {
  return {
    type: operation.type,
    stockName: operation.stockName,
    currency: operation.currency,
    amount: String(operation.amount),
    price: String(operation.price),
    quantity: String(operation.quantity),
    splitFrom: String(operation.splitFrom ?? 1),
    splitTo: String(operation.splitTo ?? 2),
    date: operation.date,
    note: operation.note
  };
}

function operationLabel(type: OperationType) {
  if (type === "BUY") return "Buy";
  if (type === "SELL") return "Sell";
  return "Split";
}

function statusLabel(status: MonthStatus) {
  if (status === "complete") return "Complete";
  if (status === "failed") return "Failed";
  return "Pending";
}

function StatusIcon({ status }: { status: MonthStatus }) {
  if (status === "complete") return <CheckCircle2 className="status-icon complete" aria-label="Complete" />;
  if (status === "failed") return <XCircle className="status-icon failed" aria-label="Failed" />;
  return <Minus className="status-icon pending" aria-label="Pending" />;
}

function splitRatioLabel(operation: InvestmentOperation) {
  if (!operation.splitFrom || !operation.splitTo) return "ratio not set";
  return `${formatNumber(operation.splitFrom)} -> ${formatNumber(operation.splitTo)}`;
}

function historyTitle(operation: InvestmentOperation) {
  if (operation.type === "SPLIT") {
    return `${operation.date} · ${operation.stockName} · Split ${splitRatioLabel(operation)}`;
  }

  return `${operation.date} · ${operation.stockName} · ${formatMoney(operation.amount, operation.currency)}`;
}

function historyMeta(operation: InvestmentOperation) {
  if (operation.type === "SPLIT") {
    return `Ratio ${splitRatioLabel(operation)}${operation.note ? ` · ${operation.note}` : ""}`;
  }

  return `Price ${formatMoney(operation.price, operation.currency)} · Quantity ${formatNumber(operation.quantity)}${
    operation.note ? ` · ${operation.note}` : ""
  }`;
}

function createStatusCounts() {
  return {
    complete: 0,
    pending: 0,
    failed: 0
  };
}

function getOverviewAnalysis(months: AppState["overview"]["months"]) {
  const monthCounts = createStatusCounts();
  const stockCounts = createStatusCounts();

  months.forEach((month) => {
    monthCounts[month.status] += 1;
    month.stocks.forEach((stock) => {
      stockCounts[stock.status] += 1;
    });
  });

  return {
    monthCounts,
    stockCounts,
    totalMonths: months.length,
    totalStockGoals: months.reduce((total, month) => total + month.stocks.length, 0)
  };
}

function getAggregateStatus(counts: ReturnType<typeof createStatusCounts>): MonthStatus {
  if (counts.failed > 0) return "failed";
  if (counts.pending > 0) return "pending";
  return "complete";
}

function getYearGroups(months: AppState["overview"]["months"]) {
  return Array.from(
    months.reduce((map, month) => {
      const year = month.month.slice(0, 4);
      const current = map.get(year) ?? [];
      current.push(month);
      map.set(year, current);
      return map;
    }, new Map<string, AppState["overview"]["months"]>())
  )
    .map(([year, yearMonths]) => {
      const monthCounts = createStatusCounts();
      const stockCounts = createStatusCounts();

      yearMonths.forEach((month) => {
        monthCounts[month.status] += 1;
        month.stocks.forEach((stock) => {
          stockCounts[stock.status] += 1;
        });
      });

      return {
        year,
        months: yearMonths,
        monthCounts,
        stockCounts,
        status: getAggregateStatus(monthCounts),
        totalStockGoals: yearMonths.reduce((total, month) => total + month.stocks.length, 0)
      };
    })
    .sort((a, b) => a.year.localeCompare(b.year));
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [form, setForm] = useState<OperationFormValues>(() => emptyForm("BUY"));
  const currentMonthRef = useRef<HTMLDivElement | null>(null);

  const stockOptions = useMemo(() => getStockOptions(state?.settings), [state?.settings]);

  async function loadState() {
    const payload = await fetchState();
    setState(payload);
    const options = getStockOptions(payload.settings);
    setForm(emptyForm("BUY", options[0]));
  }

  useEffect(() => {
    async function load() {
      try {
        const auth = await fetchAuthStatus();
        setAuthEnabled(auth.enabled);

        if (auth.enabled && !auth.authenticated) {
          setAuthRequired(true);
          return;
        }

        await loadState();
      } catch (err) {
        if (err instanceof Error && err.message === "Authentication required") {
          setAuthRequired(true);
          setError("");
          return;
        }

        setError(err instanceof Error ? err.message : "Unable to load Investment Planner.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleLogin(password: string) {
    setError("");
    await loginWithPassword(password);
    setAuthRequired(false);
    await loadState();
  }

  async function handleLogout() {
    await logout();
    setState(null);
    setAuthRequired(true);
  }

  useEffect(() => {
    if (!stockOptions.length) return;

    const currentExists = stockOptions.some(
      (option) => option.stockName === form.stockName && option.currency === form.currency
    );

    if (!currentExists) {
      setForm((current) => ({
        ...current,
        stockName: stockOptions[0].stockName,
        currency: stockOptions[0].currency
      }));
    }
  }, [form.currency, form.stockName, stockOptions]);

  useEffect(() => {
    currentMonthRef.current?.scrollIntoView({ block: "center" });
  }, [state?.overview.currentMonth, state?.overview.months.length]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      const nextState = await createOperation(form);
      setState(nextState);
      setForm((current) => ({
        ...emptyForm(current.type, { stockName: current.stockName, currency: current.currency }),
        date: todayTaiwan()
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  async function handleSaveSettings(settings: SettingsState) {
    setError("");
    const nextState = await saveSettings(settings);
    setState(nextState);
    setSettingsOpen(false);
  }

  function selectStock(value: string) {
    const option = stockOptions.find((item) => stockKey(item.stockName, item.currency) === value);
    if (!option) return;
    setForm((current) => ({
      ...current,
      stockName: option.stockName,
      currency: option.currency
    }));
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-panel">Loading Investment Planner...</div>
      </main>
    );
  }

  if (authRequired) {
    return <LoginPanel error={error} onLogin={handleLogin} />;
  }

  if (!state) {
    return (
      <main className="app-shell">
        <div className="error-panel">
          <AlertTriangle />
          <span>{error || "Unable to load Investment Planner."}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Investment Planner</h1>
          <div className="current-month">Taiwan date {todayTaiwan()}</div>
        </div>
        <div className="icon-actions">
          {authEnabled && (
            <button className="icon-button" type="button" title="Logout" aria-label="Logout" onClick={() => void handleLogout()}>
              <LogOut />
            </button>
          )}
          <button className="icon-button" type="button" title="History" aria-label="History" onClick={() => setHistoryOpen(true)}>
            <History />
          </button>
          <button className="icon-button" type="button" title="Setting" aria-label="Setting" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <AlertTriangle />
          <span>{error}</span>
          <button className="plain-icon" type="button" title="Close" onClick={() => setError("")}>
            <X />
          </button>
        </div>
      )}

      <SettingsSummary settings={state.settings} />

      <section className="operation-panel">
        <div className="section-heading">
          <h2>Operation</h2>
          <div className="segmented-control">
            {(["BUY", "SELL", "SPLIT"] as OperationType[]).map((type) => (
              <button
                key={type}
                type="button"
                className={form.type === type ? "active" : ""}
                onClick={() => setForm((current) => ({ ...current, type }))}
              >
                {operationLabel(type)}
              </button>
            ))}
          </div>
        </div>

        <form className="operation-form" onSubmit={handleSubmit}>
          <label>
            Stock
            <select
              value={stockKey(form.stockName, form.currency)}
              onChange={(event) => selectStock(event.target.value)}
              disabled={!stockOptions.length}
            >
              {stockOptions.map((option) => (
                <option key={stockKey(option.stockName, option.currency)} value={stockKey(option.stockName, option.currency)}>
                  {option.stockName} · {option.currency}
                </option>
              ))}
            </select>
          </label>
          {form.type === "SPLIT" ? (
            <>
              <label>
                From Shares
                <input
                  inputMode="decimal"
                  value={form.splitFrom}
                  onChange={(event) => setForm((current) => ({ ...current, splitFrom: event.target.value }))}
                  placeholder="1"
                  required
                />
              </label>
              <label>
                To Shares
                <input
                  inputMode="decimal"
                  value={form.splitTo}
                  onChange={(event) => setForm((current) => ({ ...current, splitTo: event.target.value }))}
                  placeholder="2"
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Amount ({form.currency})
                <input
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                  placeholder="0"
                  required
                />
              </label>
              <label>
                Price ({form.currency})
                <input
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  placeholder="0"
                  required
                />
              </label>
              <label>
                Quantity
                <input
                  inputMode="decimal"
                  value={form.quantity}
                  onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                  placeholder="0"
                  required
                />
              </label>
            </>
          )}
          <label>
            Date
            <input
              value={form.date}
              onChange={(event) => setForm((current) => ({ ...current, date: event.target.value.replace(/-/g, "/") }))}
              placeholder="yyyy/mm/dd"
              required
            />
          </label>
          <label className="wide-field">
            Note
            <input
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              placeholder="optional"
            />
          </label>
          <button className="primary-button" type="submit" disabled={!stockOptions.length}>
            <Save />
            Save {operationLabel(form.type)}
          </button>
        </form>
      </section>

      <OverviewPanel state={state} currentMonthRef={currentMonthRef} />

      {settingsOpen && (
        <SettingsModal settings={state.settings} onClose={() => setSettingsOpen(false)} onSave={handleSaveSettings} />
      )}

      {historyOpen && (
        <HistoryModal
          operations={state.operations}
          stockOptions={stockOptions}
          onClose={() => setHistoryOpen(false)}
          onStateChange={setState}
          onError={setError}
        />
      )}
    </main>
  );
}

function LoginPanel({ error, onLogin }: { error: string; onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState(error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");

    try {
      await onLogin(password);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell login-shell">
      <section className="login-panel">
        <div className="login-mark">
          <Lock />
        </div>
        <h1>Investment Planner</h1>
        {loginError && (
          <div className="error-banner inline">
            <AlertTriangle />
            <span>{loginError}</span>
          </div>
        )}
        <form className="login-form" onSubmit={submit}>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={submitting}>
            <Lock />
            Login
          </button>
        </form>
      </section>
    </main>
  );
}

function SettingsSummary({ settings }: { settings: SettingsState }) {
  return (
    <section className="summary-panel">
      <div className="section-heading">
        <h2>Setting</h2>
      </div>
      <div className="time-slot-list compact">
        {settings.timeSlots.map((slot) => (
          <div className="time-slot-row" key={slot.id}>
            <div className="time-range">
              {slot.startMonth} - {slot.endMonth}
            </div>
            <div className="stock-pill-list">
              {slot.stocks.map((stock) => (
                <span className="stock-pill" key={stock.id}>
                  {stock.stockName} {formatMoney(stock.monthlyGoal, stock.currency)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OverviewPanel({
  state,
  currentMonthRef
}: {
  state: AppState;
  currentMonthRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const analysis = getOverviewAnalysis(state.overview.months);
  const yearGroups = useMemo(() => getYearGroups(state.overview.months), [state.overview.months]);
  const currentYear = state.overview.currentMonth.slice(0, 4);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => new Set([currentYear]));

  useEffect(() => {
    setExpandedYears((current) => {
      if (current.has(currentYear)) return current;
      const next = new Set(current);
      next.add(currentYear);
      return next;
    });
  }, [currentYear]);

  function toggleYear(year: string) {
    setExpandedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <section className="overview-panel">
      <div className="section-heading">
        <h2>Overview</h2>
      </div>

      {state.overview.warnings.length > 0 && (
        <div className="warning-list">
          {state.overview.warnings.map((warning) => (
            <div className="warning-item" key={`${warning.operationId}-${warning.message}`}>
              <AlertTriangle />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="holdings-strip">
        {state.overview.holdings.length === 0 ? (
          <span className="muted-text">No holdings</span>
        ) : (
          state.overview.holdings.map((holding) => (
            <div className="holding-item" key={stockKey(holding.stockName, holding.currency)}>
              <strong>{holding.stockName}</strong>
              <span>{formatNumber(holding.quantity)} shares</span>
            </div>
          ))
        )}
      </div>

      <div className="analysis-panel">
        <div className="analysis-header">
          <h3>Analysis</h3>
        </div>
        <div className="analysis-grid">
          <div className="analysis-group">
            <div className="analysis-label">Months</div>
            <div className="analysis-total">{analysis.totalMonths}</div>
            <div className="analysis-status-list">
              <span className="analysis-chip complete">Complete {analysis.monthCounts.complete}</span>
              <span className="analysis-chip pending">Pending {analysis.monthCounts.pending}</span>
              <span className="analysis-chip failed">Failed {analysis.monthCounts.failed}</span>
            </div>
          </div>
          <div className="analysis-group">
            <div className="analysis-label">Stock Goals</div>
            <div className="analysis-total">{analysis.totalStockGoals}</div>
            <div className="analysis-status-list">
              <span className="analysis-chip complete">Complete {analysis.stockCounts.complete}</span>
              <span className="analysis-chip pending">Pending {analysis.stockCounts.pending}</span>
              <span className="analysis-chip failed">Failed {analysis.stockCounts.failed}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="month-list">
        {yearGroups.map((group) => {
          const expanded = expandedYears.has(group.year);

          return (
            <div className={`year-group ${group.status}`} key={group.year}>
              <button className="year-header" type="button" onClick={() => toggleYear(group.year)} aria-expanded={expanded}>
                <span className="year-title">
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                  {group.year}
                </span>
                <span className="year-summary">
                  <span className="analysis-chip complete">Complete {group.stockCounts.complete}</span>
                  <span className="analysis-chip pending">Pending {group.stockCounts.pending}</span>
                  <span className="analysis-chip failed">Failed {group.stockCounts.failed}</span>
                </span>
                <span className="year-total">
                  {group.months.length} months · {group.totalStockGoals} goals
                </span>
              </button>

              {expanded && (
                <div className="year-months">
                  {group.months.map((month) => (
                    <div
                      className={`month-row ${month.status} ${month.month === state.overview.currentMonth ? "current" : ""}`}
                      key={month.month}
                      ref={month.month === state.overview.currentMonth ? currentMonthRef : undefined}
                    >
                      <div className="month-main">
                        <div>
                          <div className="month-title">{month.month}</div>
                        </div>
                        <div className="month-status" title={statusLabel(month.status)}>
                          <StatusIcon status={month.status} />
                        </div>
                      </div>
                      <div className="stock-overview-list">
                        {month.stocks.map((stock) => (
                          <div className={`stock-overview-row ${stock.status}`} key={stockKey(stock.stockName, stock.currency)}>
                            <span className="stock-name">{stock.stockName}</span>
                            <span>{formatMoney(stock.actual, stock.currency)}</span>
                            <span className="muted-text">/ {formatMoney(stock.target, stock.currency)}</span>
                            <StatusIcon status={stock.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SettingsModal({
  settings,
  onClose,
  onSave
}: {
  settings: SettingsState;
  onClose: () => void;
  onSave: (settings: SettingsState) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SettingsState>(() => structuredClone(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [removeSlotId, setRemoveSlotId] = useState<string | null>(null);
  const [selectedStocks, setSelectedStocks] = useState<Set<string>>(new Set());

  function updateSlot(slotId: string, updates: Partial<TimeSlot>) {
    setDraft((current) => ({
      ...current,
      timeSlots: current.timeSlots.map((slot) => (slot.id === slotId ? { ...slot, ...updates } : slot))
    }));
  }

  function updateStock(slotId: string, stockId: string, updates: Partial<StockSetting>) {
    setDraft((current) => ({
      ...current,
      timeSlots: current.timeSlots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              stocks: slot.stocks.map((stock) =>
                stock.id === stockId
                  ? {
                      ...stock,
                      ...updates,
                      stockName: updates.stockName === undefined ? stock.stockName : updates.stockName.toUpperCase()
                    }
                  : stock
              )
            }
          : slot
      )
    }));
  }

  function addTimeSlot() {
    const startMonth = currentTaiwanMonth();
    setDraft((current) => ({
      ...current,
      timeSlots: [
        ...current.timeSlots,
        {
          id: createId(),
          startMonth,
          endMonth: addMonths(startMonth, 5),
          stocks: [{ id: createId(), stockName: "TQQQ", monthlyGoal: 0, currency: "USD" }]
        }
      ]
    }));
  }

  function removeTimeSlot(slotId: string) {
    if (!window.confirm("確認移除這個 time slot？")) return;
    setDraft((current) => ({
      ...current,
      timeSlots: current.timeSlots.filter((slot) => slot.id !== slotId)
    }));
  }

  function addStock(slotId: string) {
    setDraft((current) => ({
      ...current,
      timeSlots: current.timeSlots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              stocks: [...slot.stocks, { id: createId(), stockName: "", monthlyGoal: 0, currency: "USD" }]
            }
          : slot
      )
    }));
  }

  function toggleSelectedStock(stockId: string) {
    setSelectedStocks((current) => {
      const next = new Set(current);
      if (next.has(stockId)) next.delete(stockId);
      else next.add(stockId);
      return next;
    });
  }

  function confirmRemoveStocks(slotId: string) {
    if (selectedStocks.size === 0) {
      window.alert("請先選擇要移除的 stock。");
      return;
    }

    if (!window.confirm("確認移除所選的 stock？")) return;

    setDraft((current) => ({
      ...current,
      timeSlots: current.timeSlots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              stocks: slot.stocks.filter((stock) => !selectedStocks.has(stock.id))
            }
          : slot
      )
    }));
    setSelectedStocks(new Set());
    setRemoveSlotId(null);
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        timeSlots: [...draft.timeSlots].sort((a, b) => parseMonth(a.startMonth) - parseMonth(b.startMonth))
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal large-modal">
        <div className="modal-header">
          <h2>Setting</h2>
          <button className="plain-icon" type="button" title="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        {error && (
          <div className="error-banner inline">
            <AlertTriangle />
            <span>{error}</span>
          </div>
        )}

        <div className="settings-editor">
          {draft.timeSlots.map((slot) => (
            <div className="editor-block" key={slot.id}>
              <div className="slot-header">
                <div className="slot-dates">
                  <label>
                    Start
                    <input value={slot.startMonth} onChange={(event) => updateSlot(slot.id, { startMonth: event.target.value.replace(/-/g, "/") })} />
                  </label>
                  <label>
                    End
                    <input value={slot.endMonth} onChange={(event) => updateSlot(slot.id, { endMonth: event.target.value.replace(/-/g, "/") })} />
                  </label>
                </div>
                <div className="row-actions">
                  <button className="secondary-button" type="button" onClick={() => addStock(slot.id)}>
                    <Plus />
                    Add
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setRemoveSlotId(slot.id);
                      setSelectedStocks(new Set());
                    }}
                  >
                    <Trash2 />
                    Remove
                  </button>
                  <button className="plain-icon danger" type="button" title="Remove time slot" onClick={() => removeTimeSlot(slot.id)}>
                    <X />
                  </button>
                </div>
              </div>

              <div className="stock-editor-list">
                {slot.stocks.map((stock) => (
                  <div className="stock-editor-row" key={stock.id}>
                    {removeSlotId === slot.id && (
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={selectedStocks.has(stock.id)}
                        onChange={() => toggleSelectedStock(stock.id)}
                        aria-label={`Select ${stock.stockName}`}
                      />
                    )}
                    <input
                      className="stock-input"
                      value={stock.stockName}
                      onChange={(event) => updateStock(slot.id, stock.id, { stockName: event.target.value })}
                      placeholder="Stock"
                    />
                    <input
                      className="amount-input"
                      inputMode="decimal"
                      value={stock.monthlyGoal}
                      onChange={(event) => updateStock(slot.id, stock.id, { monthlyGoal: Number(event.target.value) })}
                      placeholder="Monthly goal"
                    />
                    <select value={stock.currency} onChange={(event) => updateStock(slot.id, stock.id, { currency: event.target.value as Currency })}>
                      <option value="USD">USD</option>
                      <option value="TWD">TWD</option>
                    </select>
                  </div>
                ))}
              </div>

              {removeSlotId === slot.id && (
                <div className="remove-bar">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setRemoveSlotId(null);
                      setSelectedStocks(new Set());
                    }}
                  >
                    Cancel
                  </button>
                  <button className="danger-button" type="button" onClick={() => confirmRemoveStocks(slot.id)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={addTimeSlot}>
            <Plus />
            Time Slot
          </button>
          <div className="footer-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="button" onClick={submit} disabled={saving}>
              <Save />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({
  operations,
  stockOptions,
  onClose,
  onStateChange,
  onError
}: {
  operations: InvestmentOperation[];
  stockOptions: StockOption[];
  onClose: () => void;
  onStateChange: (state: AppState) => void;
  onError: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<OperationFormValues | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const chronological = useMemo(
    () =>
      [...operations].sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0) return byDate;
        return a.createdAt.localeCompare(b.createdAt);
      }),
    [operations]
  );

  function optionsFor(operation: InvestmentOperation) {
    const map = new Map(stockOptions.map((option) => [stockKey(option.stockName, option.currency), option]));
    const key = stockKey(operation.stockName, operation.currency);
    if (!map.has(key)) map.set(key, { stockName: operation.stockName, currency: operation.currency });
    return Array.from(map.values());
  }

  async function run(operationId: string, action: () => Promise<AppState>) {
    setBusyId(operationId);
    onError("");
    try {
      onStateChange(await action());
      setEditingId(null);
      setEditForm(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "History update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal large-modal">
        <div className="modal-header">
          <h2>History</h2>
          <button className="plain-icon" type="button" title="Close" onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="history-list">
          {chronological.length === 0 ? (
            <div className="muted-text">No operations</div>
          ) : (
            chronological.map((operation) => {
              const activeEditForm = editingId === operation.id ? editForm : null;
              const availableOptions = optionsFor(operation);

              return (
                <div className={`history-row ${operation.status === "deleted" ? "deleted" : ""}`} key={operation.id}>
                  {activeEditForm ? (
                    <HistoryEditForm
                      form={activeEditForm}
                      options={availableOptions}
                      onChange={setEditForm}
                      onCancel={() => {
                        setEditingId(null);
                        setEditForm(null);
                      }}
                      onSave={() => run(operation.id, () => updateOperation(operation.id, activeEditForm))}
                      busy={busyId === operation.id}
                    />
                  ) : (
                    <>
                      <div className="history-main">
                        <span className={`type-badge ${operation.type.toLowerCase()}`}>{operation.type}</span>
                        <div>
                          <div className="history-title">{historyTitle(operation)}</div>
                          <div className="history-meta">{historyMeta(operation)}</div>
                          <div className="history-updated">Updated {formatTaiwanDateTime(operation.updatedAt)}</div>
                          {operation.status === "deleted" && <div className="deleted-label">Deleted</div>}
                        </div>
                      </div>
                      <div className="row-actions">
                        {operation.status === "active" && (
                          <>
                            <button
                              className="plain-icon"
                              type="button"
                              title="Edit"
                              onClick={() => {
                                setEditingId(operation.id);
                                setEditForm(formFromOperation(operation));
                              }}
                            >
                              <Pencil />
                            </button>
                            <button
                              className="plain-icon danger"
                              type="button"
                              title="Delete"
                              disabled={busyId === operation.id}
                              onClick={() => {
                                if (window.confirm("確認刪除這筆操作紀錄？")) {
                                  void run(operation.id, () => deleteOperation(operation.id));
                                }
                              }}
                            >
                              <Trash2 />
                            </button>
                          </>
                        )}
                        {operation.history.length > 0 && (
                          <button
                            className="plain-icon"
                            type="button"
                            title="Undo"
                            disabled={busyId === operation.id}
                            onClick={() => {
                              if (window.confirm("確認還原上一版？")) {
                                void run(operation.id, () => undoOperation(operation.id));
                              }
                            }}
                          >
                            <RotateCcw />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryEditForm({
  form,
  options,
  onChange,
  onCancel,
  onSave,
  busy
}: {
  form: OperationFormValues;
  options: StockOption[];
  onChange: (form: OperationFormValues) => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  function selectStock(value: string) {
    const option = options.find((item) => stockKey(item.stockName, item.currency) === value);
    if (!option) return;
    onChange({ ...form, stockName: option.stockName, currency: option.currency });
  }

  function selectType(type: OperationType) {
    onChange({
      ...form,
      type,
      splitFrom: form.splitFrom || "1",
      splitTo: form.splitTo || "2"
    });
  }

  return (
    <div className="history-edit-form">
      <select value={form.type} onChange={(event) => selectType(event.target.value as OperationType)}>
        <option value="BUY">BUY</option>
        <option value="SELL">SELL</option>
        <option value="SPLIT">SPLIT</option>
      </select>
      <select value={stockKey(form.stockName, form.currency)} onChange={(event) => selectStock(event.target.value)}>
        {options.map((option) => (
          <option key={stockKey(option.stockName, option.currency)} value={stockKey(option.stockName, option.currency)}>
            {option.stockName} · {option.currency}
          </option>
        ))}
      </select>
      {form.type === "SPLIT" ? (
        <>
          <input
            value={form.splitFrom}
            inputMode="decimal"
            onChange={(event) => onChange({ ...form, splitFrom: event.target.value })}
            placeholder="From"
          />
          <input
            value={form.splitTo}
            inputMode="decimal"
            onChange={(event) => onChange({ ...form, splitTo: event.target.value })}
            placeholder="To"
          />
        </>
      ) : (
        <>
          <input value={form.amount} inputMode="decimal" onChange={(event) => onChange({ ...form, amount: event.target.value })} />
          <input value={form.price} inputMode="decimal" onChange={(event) => onChange({ ...form, price: event.target.value })} />
          <input
            value={form.quantity}
            inputMode="decimal"
            onChange={(event) => onChange({ ...form, quantity: event.target.value })}
            placeholder="Quantity"
          />
        </>
      )}
      <input value={form.date} onChange={(event) => onChange({ ...form, date: event.target.value.replace(/-/g, "/") })} />
      <input value={form.note} onChange={(event) => onChange({ ...form, note: event.target.value })} placeholder="Note" />
      <div className="row-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
          <Save />
          Save
        </button>
      </div>
    </div>
  );
}

export default App;
