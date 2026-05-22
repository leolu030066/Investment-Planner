import mongoose, { Schema } from "mongoose";

const StockSettingSchema = new Schema(
  {
    id: { type: String, required: true },
    stockName: { type: String, required: true },
    goalType: { type: String, enum: ["BUY", "SELL"], default: "BUY" },
    monthlyGoal: { type: Number, required: true },
    currency: { type: String, enum: ["USD", "TWD"], required: true }
  },
  { _id: false }
);

const TimeSlotSchema = new Schema(
  {
    id: { type: String, required: true },
    startMonth: { type: String, required: true },
    endMonth: { type: String, required: true },
    stocks: { type: [StockSettingSchema], default: [] }
  },
  { _id: false }
);

const SettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    focusMonth: { type: String },
    timeSlots: { type: [TimeSlotSchema], default: [] }
  },
  { timestamps: true }
);

export const SettingModel =
  mongoose.models.Setting || mongoose.model("Setting", SettingSchema);
