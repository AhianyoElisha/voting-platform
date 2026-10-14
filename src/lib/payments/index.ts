import { HUBTEL_PROVIDER_NAME, HubtelPaymentProvider } from './hubtel'
import { HubtelConfigError } from './hubtel/config'
import { MOCK_PROVIDER_NAME, MockPaymentProvider } from './mock'
import type { PaymentProvider } from './provider'

export type { CallbackResult, InitiateInput, InitiateResult, PaymentProvider, ProviderStatus } from './provider'

export class PaymentProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentProviderNotConfiguredError'
  }
}

/**
 * Selects the aggregator from `PAYMENT_PROVIDER`: `hubtel` (decision #11) or
 * `mock` for development, which never runs in production.
 */
export function getPaymentProvider(name = process.env.PAYMENT_PROVIDER): PaymentProvider {
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
    `PAYMENT_PROVIDER is ${name ? `"${name}"` : 'unset'}; expected "hubtel" or "mock"`
  )
}

export function isMockProviderActive(): boolean {
  try {
    return getPaymentProvider().name === MOCK_PROVIDER_NAME
  } catch {
    return false
  }
}
