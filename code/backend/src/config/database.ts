import mongoose from "mongoose";

export async function connectDatabase(): Promise<typeof mongoose | null> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn("MONGODB_URI is not defined in environment variables. Database not connected.");
    return null;
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`MongoDB connected successfully to host: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected cleanly.");
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
