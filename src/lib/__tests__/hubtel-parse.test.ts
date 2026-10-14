import { describe, expect, test } from 'vitest'
import { amountToPesewas, channelForMsisdn, parseHubtelCallback, parseHubtelStatus } from '../payments/hubtel/parse'

/** Classic Receive Money callback, as documented by third-party integrations. */
const nestedSuccess = {
  ResponseCode: '0000',
  Data: {
    Amount: 1.5,
    Charges: 0.03,
    AmountAfterCharges: 1.47,
    Description: '10 votes for Ama Owusu (4321)',
    ClientReference: 'pay_abc123',
    TransactionId: 'hub_tx_1',
    ExternalTransactionId: 'mtn_99',
  },
}

const flatCompleted = {
  TransactionId: 'hub_tx_2',
  ClientReference: 'pay_def456',
  Amount: '2.00',
  Status: 'Completed',
  PaymentMethod: 'mtn-gh',
  ResponseCode: '00',
}

describe('parseHubtelCallback', () => {
  test('nested shape: 0000 is success, anything else failed, amounts in pesewas', () => {
    const ok = parseHubtelCallback(nestedSuccess, 'nested')!
    expect(ok).toMatchObject({
      clientReference: 'pay_abc123',
      transactionId: 'hub_tx_1',
      amountPesewas: 150,
      status: 'success',
      chargesPesewas: 3,
      amountAfterChargesPesewas: 147,
    })
    const failed = parseHubtelCallback({ ...nestedSuccess, ResponseCode: '2001' }, 'nested')!
    expect(failed.status).toBe('failed')
    expect(failed.clientReference).toBe('pay_abc123')
  })

  test('flat shape: Status words map to outcomes', () => {
    expect(parseHubtelCallback(flatCompleted, 'flat')).toMatchObject({
      clientReference: 'pay_def456',
      transactionId: 'hub_tx_2',
      amountPesewas: 200,
      status: 'success',
      network: 'mtn-gh',
    })
    expect(parseHubtelCallback({ ...flatCompleted, Status: 'Failed' }, 'flat')?.status).toBe('failed')
    expect(parseHubtelCallback({ ...flatCompleted, Status: 'Timeout' }, 'flat')?.status).toBe('failed')
    expect(parseHubtelCallback({ ...flatCompleted, Status: 'Pending' }, 'flat')?.status).toBe('pending')
    // Flat shape wrapped in Data, lower-camel keys.
    expect(
      parseHubtelCallback({ data: { clientReference: 'x1', status: 'completed', amount: 1 } }, 'flat')
    ).toMatchObject({
      clientReference: 'x1',
      status: 'success',
      amountPesewas: 100,
    })
  })

  test('fails closed on junk', () => {
    expect(parseHubtelCallback(null, 'nested')).toBeNull()
    expect(parseHubtelCallback('hello', 'flat')).toBeNull()
    expect(parseHubtelCallback({ ResponseCode: '0000' }, 'nested')).toBeNull()
    expect(parseHubtelCallback({ Data: { Amount: 1 } }, 'nested')).toBeNull()
    expect(parseHubtelCallback({ Status: 'Completed' }, 'flat')).toBeNull()
  })
})

describe('parseHubtelStatus', () => {
  test('nested status response: Paid/Unpaid/Refunded', () => {
    const paid = {
      message: 'Successful',
      responseCode: '0000',
      data: {
        date: '2026-10-14T12:00:00Z',
        status: 'Paid',
        transactionId: 'hub_tx_1',
        externalTransactionId: 'mtn_99',
        paymentMethod: 'mobilemoney',
        clientReference: 'pay_abc123',
        currencyCode: 'GHS',
        amount: 1.5,
        charges: 0.03,
        amountAfterCharges: 1.47,
      },
    }
    expect(parseHubtelStatus(paid, 'nested')).toMatchObject({
      status: 'success',
      amountPesewas: 150,
      transactionId: 'hub_tx_1',
    })
    expect(parseHubtelStatus({ ...paid, data: { ...paid.data, status: 'Unpaid' } }, 'nested')?.status).toBe('pending')
    expect(parseHubtelStatus({ ...paid, data: { ...paid.data, status: 'Refunded' } }, 'nested')?.status).toBe('failed')
    // A failed query (bad reference) is not a verdict.
    expect(parseHubtelStatus({ responseCode: '4000', message: 'not found', data: null }, 'nested')).toBeNull()
    expect(
      parseHubtelStatus({ responseCode: '0000', data: { clientReference: 'x', status: 'Weird' } }, 'nested')
    ).toBeNull()
  })

  test('flat status response', () => {
    expect(
      parseHubtelStatus({ ResponseCode: '00', Data: { ...flatCompleted, Status: 'Completed' } }, 'flat')?.status
    ).toBe('success')
    expect(
      parseHubtelStatus({ ResponseCode: '00', Data: { ...flatCompleted, Status: 'Cancelled' } }, 'flat')?.status
    ).toBe('failed')
  })
})

describe('amounts and channels', () => {
  test('amountToPesewas handles numbers, strings and junk', () => {
    expect(amountToPesewas(1.5)).toBe(150)
    expect(amountToPesewas('0.05')).toBe(5)
    expect(amountToPesewas(10)).toBe(1000)
    expect(amountToPesewas('abc')).toBeNull()
    expect(amountToPesewas(null)).toBeNull()
    expect(amountToPesewas(-1)).toBeNull()
  })

  test('channelForMsisdn maps Ghanaian prefixes', () => {
    expect(channelForMsisdn('233241234567')).toBe('mtn-gh')
    expect(channelForMsisdn('233551234567')).toBe('mtn-gh')
    expect(channelForMsisdn('233201234567')).toBe('vodafone-gh')
    expect(channelForMsisdn('233501234567')).toBe('vodafone-gh')
    expect(channelForMsisdn('233271234567')).toBe('tigo-gh')
    expect(channelForMsisdn('233561234567')).toBe('tigo-gh')
    expect(channelForMsisdn('233991234567')).toBeNull()
  })
})
