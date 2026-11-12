import { HUBTEL_PROVIDER_NAME, HubtelPaymentProvider } from './hubtel'
import { HubtelConfigError } from './hubtel/config'
import { MOCK_PROVIDER_NAME, MockPaymentProvider } from './mock'
import { PAYSTACK_PROVIDER_NAME, PaystackPaymentProvider } from './paystack'
import { PaystackConfigError } from './paystack/config'
import type { PaymentProvider } from './provider'

export type {
  CallbackResult,
  InitiateInput,
  InitiateResult,
  OtpResult,
  PaymentProvider,
  ProviderStatus,
} from './provider'

export class PaymentProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentProviderNotConfiguredError'
  }
}

/**
 * Selects the payment provider from `PAYMENT_PROVIDER`: `paystack` (decided
 * 2026-11-12), `hubtel` (its adapter is kept; Hubtel now runs USSD only) or
 * `mock` for development, which never runs in production.
 */
export function getPaymentProvider(name = process.env.PAYMENT_PROVIDER): PaymentProvider {
  if (name === PAYSTACK_PROVIDER_NAME) {
    try {
      return new PaystackPaymentProvider()
    } catch (err) {
      if (err instanceof PaystackConfigError) throw new PaymentProviderNotConfiguredError(`Paystack: ${err.message}`)
      throw err
    }
  }
  if (name === HUBTEL_PROVIDER_NAME) {
    try {
      return new HubtelPaymentProvider()
    } catch (err) {
      if (err instanceof HubtelConfigError) throw new PaymentProviderNotConfiguredError(`Hubtel: ${err.message}`)
      throw err
    }
  }
  if (name === MOCK_PROVIDER_NAME) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION !== 'true') {
      throw new PaymentProviderNotConfiguredError('The mock payment provider is not allowed in production')
    }
    return new MockPaymentProvider()
  }
  throw new PaymentProviderNotConfiguredError(
    `PAYMENT_PROVIDER is ${name ? `"${name}"` : 'unset'}; expected "paystack", "hubtel" or "mock"`
  )
}

export function isMockProviderActive(): boolean {
  try {
    return getPaymentProvider().name === MOCK_PROVIDER_NAME
  } catch {
    return false
  }
}
