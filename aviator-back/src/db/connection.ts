import mongoose from "mongoose";
import { config } from "../config";

let connecting: Promise<typeof mongoose> | null = null;

export const connectDb = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) return;
  if (!connecting) {
    connecting = mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
  }
  await connecting;
  console.log(`[db] connected to ${config.mongoUri}`);
};
