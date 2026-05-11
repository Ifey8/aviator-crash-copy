import type { PaymentProvider } from "./types";
import type { PayoutProvider } from "./payoutTypes";
import type { PaymentChannelDoc } from "../db/models/PaymentChannel";

/**
 * Provider Type Catalog.
 *
 * Each entry defines ONE provider implementation (e.g. Payme, Razorpay).
 * It declares:
 *   • What credential + param fields the admin form should render
 *   • Which countries the provider serves
 *   • Whether it supports payin / payout / both
 *   • Factories that build a runtime instance from a channel's config
 *
 * Adding a new provider:
 *   1. Implement PaymentProvider and/or PayoutProvider in providers/<name>.ts
 *      with a constructor that takes a ChannelConfig.
 *   2. Append a ProviderType entry below.
 *   3. Admin can immediately create channels for that provider via the UI.
 *
 * No code changes elsewhere required — routes, channel registry, and
 * admin UI all read from this catalog at runtime.
 */

export type FieldKind = "text" | "secret" | "select" | "number";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Default applied when an admin creates a new channel of this type. */
  default?: string;
  hint?: string;
  /** Only for kind="select". */
  options?: { value: string; label: string }[];
}

export interface ChannelConfig {
  channelCode: string;
  credentials: Record<string, string>;
  params: Record<string, string>;
}

export interface ProviderType {
  /** Stable key, matches PaymentChannel.provider. */
  name: string;
  /** Display name in admin UI. */
  displayName: string;
  /** ISO country codes this provider can serve. Used by the admin UI to gate the country selector. */
  countries: string[];
  /** Which directions this provider implements (UI hides toggles for ones it can't do). */
  supports: { payin: boolean; payout: boolean };
  /** Schema for credentials map. UI renders these as form fields. */
  credentialFields: FieldSpec[];
  /** Schema for params map. */
  paramFields: FieldSpec[];
  /** Build a recharge provider from a channel config. Required iff supports.payin. */
  createPaymentProvider?: (cfg: ChannelConfig) => PaymentProvider;
  /** Build a payout provider from a channel config. Required iff supports.payout. */
  createPayoutProvider?: (cfg: ChannelConfig) => PayoutProvider;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const types = new Map<string, ProviderType>();

export const registerProviderType = (def: ProviderType): void => {
  types.set(def.name, def);
};

export const getProviderType = (name: string): ProviderType | null =>
  types.get(name) || null;

export const listProviderTypes = (): ProviderType[] => Array.from(types.values());

/**
 * Build a runtime config object from a stored channel doc. Used by
 * factories to construct provider instances.
 */
export const channelToConfig = (channel: PaymentChannelDoc): ChannelConfig => {
  // Mongoose Map → plain object
  const credentials = channel.credentials instanceof Map
    ? Object.fromEntries((channel.credentials as any).entries())
    : { ...(channel.credentials as any) };
  const params = channel.params instanceof Map
    ? Object.fromEntries((channel.params as any).entries())
    : { ...(channel.params as any) };
  return {
    channelCode: channel.code,
    credentials,
    params,
  };
};
