import "server-only";
import type { Config } from "./db";

export function metaCredentials(config: Pick<Config, "meta_app_id" | "meta_app_secret">) {
  return {
    appId: process.env.META_APP_ID || config.meta_app_id || "",
    appSecret: process.env.META_APP_SECRET || config.meta_app_secret || "",
    configId: process.env.FACEBOOK_LOGIN_CONFIG_ID || "",
  };
}
