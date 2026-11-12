import { describe, expect, it } from 'vitest'
import { tokenFromScan } from '../tickets/scan-input'

const TOKEN = 'tk_6af572a8002768435e7e_0.6VH_r-oiv8gpDAXkaXEh2b'

describe('tokenFromScan', () => {
  it('passes a bare code through, trimmed', () => {
    expect(tokenFromScan(`  ${TOKEN}\n`)).toBe(TOKEN)
  })

  it('extracts the token from a pasted ticket link', () => {
    expect(tokenFromScan(`http://localhost:3000/t/${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromScan(`https://voteapp.example/t/${TOKEN}`)).toBe(TOKEN)
  })

  it('drops a query string, fragment or trailing slash', () => {
    expect(tokenFromScan(`https://voteapp.example/t/${TOKEN}?utm=wa`)).toBe(TOKEN)
    expect(tokenFromScan(`https://voteapp.example/t/${TOKEN}#qr`)).toBe(TOKEN)
    expect(tokenFromScan(`https://voteapp.example/t/${TOKEN}/`)).toBe(TOKEN)
  })
})
