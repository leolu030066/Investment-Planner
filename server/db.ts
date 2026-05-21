import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDB() {
  if (!process.env.MONGO_URL) {
    throw new Error("MONGO_URL is missing. Create .env.local from .env.example and add your MongoDB Atlas URI.");
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URL, {
      dbName: "investment-planner",
      serverSelectionTimeoutMS: 8000
    });
  }

  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "Unable to connect to MongoDB Atlas.",
        "Check that the cluster is fully deployed, your current public IP is in Atlas Network Access, and your network allows MongoDB TLS traffic on port 27017.",
        `Driver error: ${detail}`
      ].join(" ")
    );
  }
}
