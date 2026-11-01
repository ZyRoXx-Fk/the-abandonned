import mongoose, { type ConnectOptions, type Connection } from "mongoose";

function buildConnectionOptions(): ConnectOptions {
  return {
    autoIndex: true,
  };
}

function redactMongoSecrets(value: string): string {
  return value.replace(/mongodb(\+srv)?:\/\/[^\s@]+@/gi, "mongodb$1://<redacted>@");
}

function sanitizeMongoError(error: unknown): unknown {
  if (error instanceof Error) {
    error.message = redactMongoSecrets(error.message);
  }
  return error;
}

export async function createMongoConnection(uri: string): Promise<Connection> {
  const connection = mongoose.createConnection(uri, buildConnectionOptions());

  try {
    return await connection.asPromise();
  } catch (error) {
    await connection.close().catch(() => undefined);
    throw sanitizeMongoError(error);
  }
}

export async function connectDatabase(): Promise<typeof mongoose | null> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn("MONGODB_URI is not defined in environment variables. Database not connected.");
    return null;
  }

  try {
    const conn = await mongoose.connect(uri, buildConnectionOptions());
    console.log(`MongoDB connected successfully to host: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    const sanitized = sanitizeMongoError(error);
    console.error("MongoDB connection error:", sanitized);
    throw sanitized;
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
