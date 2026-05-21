import mongoose, { Schema } from "mongoose";

const OperationSnapshotSchema = new Schema(
  {
    type: { type: String, enum: ["BUY", "SELL", "SPLIT"], required: true },
    stockName: { type: String, required: true },
    currency: { type: String, enum: ["USD", "TWD"], required: true },
    amount: { type: Number, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    date: { type: String, required: true },
    note: { type: String, default: "" },
    status: { type: String, enum: ["active", "deleted"], required: true },
    savedAt: { type: String, required: true }
  },
  { _id: false }
);

const OperationSchema = new Schema(
  {
    type: { type: String, enum: ["BUY", "SELL", "SPLIT"], required: true },
    stockName: { type: String, required: true },
    currency: { type: String, enum: ["USD", "TWD"], required: true },
    amount: { type: Number, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    date: { type: String, required: true },
    note: { type: String, default: "" },
    status: { type: String, enum: ["active", "deleted"], default: "active" },
    history: { type: [OperationSnapshotSchema], default: [] }
  },
  { timestamps: true }
);

export const OperationModel =
  mongoose.models.Operation || mongoose.model("Operation", OperationSchema);
