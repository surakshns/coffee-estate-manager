import { describe, expect, it } from 'vitest'
import { currentAdvanceWeek, estateToday } from './estateDates'

describe('estate calendar', () => {
  it('uses the India date around midnight rather than the UTC date', () => {
    expect(estateToday(new Date('2026-10-06T18:29:00Z'))).toBe('2026-10-06')
    expect(estateToday(new Date('2026-10-06T18:30:00Z'))).toBe('2026-10-07')
    expect(currentAdvanceWeek(new Date('2026-10-06T18:29:00Z'))).toBe('2026-09-30')
    expect(currentAdvanceWeek(new Date('2026-10-06T18:30:00Z'))).toBe('2026-10-07')
  })

  it('keeps the current pay week when it crosses month and year boundaries', () => {
    expect(currentAdvanceWeek(new Date('2026-10-04T12:00:00Z'))).toBe('2026-09-30')
    expect(currentAdvanceWeek(new Date('2026-01-01T12:00:00Z'))).toBe('2025-12-31')
  })
})
