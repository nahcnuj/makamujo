/**
 * Host-side Basic auth password loading with optional file persistence.
 * Pure selection lives in lib/domain/console/access.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type ResolvedConsoleBasicAuthPassword,
  resolveConsoleBasicAuthPassword,
} from "./domain/console/access";

export const DEFAULT_CONSOLE_BASIC_AUTH_PASSWORD_FILE = resolve(
  process.cwd(),
  "var/console-basic-auth-password",
);

export const resolveConsoleBasicAuthPasswordFilePath = (
  envFilePath: string | undefined = process.env
    .CONSOLE_BASIC_AUTH_PASSWORD_FILE,
): string =>
  envFilePath && envFilePath.length > 0
    ? resolve(envFilePath)
    : DEFAULT_CONSOLE_BASIC_AUTH_PASSWORD_FILE;

const readPasswordFile = (filePath: string): string | undefined => {
  if (!existsSync(filePath)) return undefined;
  try {
    const text = readFileSync(filePath, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Env wins; otherwise reuse password file; otherwise generate, persist (mode 0600), and return.
 */
export const loadOrCreateConsoleBasicAuthPassword = (options?: {
  envPassword?: string | undefined;
  passwordFilePath?: string;
}): ResolvedConsoleBasicAuthPassword & { passwordFilePath: string } => {
  const passwordFilePath =
    options?.passwordFilePath ?? resolveConsoleBasicAuthPasswordFilePath();
  const filePassword = readPasswordFile(passwordFilePath);
  const resolved = resolveConsoleBasicAuthPassword({
    envPassword: options?.envPassword,
    filePassword,
  });

  if (resolved.generated) {
    mkdirSync(dirname(passwordFilePath), { recursive: true });
    writeFileSync(passwordFilePath, `${resolved.password}\n`, { mode: 0o600 });
  }

  return { ...resolved, passwordFilePath };
};
