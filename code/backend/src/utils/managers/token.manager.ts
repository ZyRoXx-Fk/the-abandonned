import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import crypto from "crypto";

export class TokenManager {
  static assertConfigured(): void {
    void this.accessSecret;
  }

  private static get accessSecret(): string {
    const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET or ACCESS_TOKEN_SECRET is not defined");
    }
    return secret;
  }

  static async generateToken(payload: object, expiresIn: string = "7d"): Promise<string> {
    return new Promise((resolve, reject) => {
      jwt.sign(
        payload,
        this.accessSecret,
        { expiresIn } as SignOptions,
        (err, token) => {
          if (err || !token) {
            return reject(err || new Error("Token generation failed"));
          }
          resolve(token);
        }
      );
    });
  }

  static async verifyToken<T = JwtPayload>(token: string): Promise<T> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, this.accessSecret, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded as T);
      });
    });
  }

  static decodeToken<T = JwtPayload>(token: string): T | null {
    const decoded = jwt.decode(token);
    return decoded as T | null;
  }

  // Generates a readable random link code for ChatGPT MCP pairing (e.g. TRUST-849201)
  static generateLinkToken(prefix: string = "TRUST", length: number = 6): string {
    const randomHex = crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length).toUpperCase();
    return `${prefix}-${randomHex}`;
  }
}

export default TokenManager;
