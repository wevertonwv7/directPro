import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
export function encryptionKey(): Buffer {
  const value = process.env.CREDENTIALS_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Configure CREDENTIALS_ENCRYPTION_KEY com 64 caracteres hexadecimais no servidor.");
  }
  return Buffer.from(value, "hex");
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptSecret(value: string): string {
  // Leitura compatível com instalações anteriores; novas gravações são cifradas.
  if (!value.startsWith(PREFIX)) return value;
  const data = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export function redactSecrets(value: unknown): string {
  return String(value)
    .replace(/(?:https?:\/\/)[^\s"<>]+/g, (url) => {
      try {
        const parsed = new URL(url);
        for (const name of ["access_token", "client_secret", "fb_exchange_token", "code", "input_token"]) {
          if (parsed.searchParams.has(name)) parsed.searchParams.set(name, "[redacted]");
        }
        if (parsed.password) parsed.password = "[redacted]";
        return parsed.toString();
      } catch { return "[URL omitida]"; }
    })
    .replace(/((?:access_token|client_secret|app_secret|fb_exchange_token)\s*["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1[redacted]")
    .replace(/\bEA[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
}
