import { describe, expect, it } from 'vitest'
import {
  aggregateByDay,
  aggregateByMonth,
  aggregateByWeek,
  aggregateByYear,
  convertRainfall,
  formatRainfall,
  getCoffeeSeason,
  getIntensity,
  type DailyRainRecord
} from './rainfall'

describe('rainfall module', () => {
  describe('unit conversions', () => {
    it('converts mm to inches accurately (25.4 mm = 1 inch)', () => {
      expect(convertRainfall(25.4, 'inches')).toBe(1)
      expect(convertRainfall(50.8, 'inches')).toBe(2)
      expect(convertRainfall(12.7, 'inches')).toBe(0.5)
    })

    it('converts mm to cents accurately (100 cents = 1 inch = 25.4 mm)', () => {
      // 25.4 mm / 0.254 = 100 cents
      expect(convertRainfall(25.4, 'cents')).toBe(100)
      // 12.7 mm = 50 cents
      expect(convertRainfall(12.7, 'cents')).toBe(50)
    })

    it('formats rainfall with appropriate unit suffixes', () => {
      expect(formatRainfall(25.4, 'inches')).toBe('1.00″')
      expect(formatRainfall(25.4, 'cents')).toBe('100.0 cents')
      expect(formatRainfall(25.4, 'mm')).toBe('25.4 mm')
    })
  })

  describe('coffee season and rain intensity classification', () => {
    it('correctly maps months to coffee seasonal stages', () => {
      expect(getCoffeeSeason(1)).toBe('dry') // Jan
      expect(getCoffeeSeason(3)).toBe('blossom') // Mar
      expect(getCoffeeSeason(4)).toBe('blossom') // Apr
      expect(getCoffeeSeason(5)).toBe('backing') // May
      expect(getCoffeeSeason(7)).toBe('monsoon') // Jul
      expect(getCoffeeSeason(10)).toBe('post-monsoon') // Oct
      expect(getCoffeeSeason(12)).toBe('dry') // Dec
    })

    it('classifies rainfall intensities', () => {
      expect(getIntensity(0)).toBe('none')
      expect(getIntensity(5)).toBe('light')
      expect(getIntensity(20)).toBe('moderate')
      expect(getIntensity(50)).toBe('heavy')
      expect(getIntensity(85)).toBe('torrential')
    })
  })

  describe('aggregations', () => {
    const mockDaily: DailyRainRecord[] = [
      { date: '2025-03-15', precipitationMm: 35.5 }, // Blossom
      { date: '2025-03-16', precipitationMm: 12.0 },
      { date: '2025-04-10', precipitationMm: 25.0 }, // Blossom
      { date: '2025-05-05', precipitationMm: 45.0 }, // Backing
      { date: '2025-07-12', precipitationMm: 120.0 }, // Monsoon
      { date: '2025-07-13', precipitationMm: 80.0 },
      { date: '2024-07-10', precipitationMm: 95.0 }
    ]

    it('aggregates by year correctly with previous year comparisons and monthly breakdown', () => {
      const byYear = aggregateByYear(mockDaily)
      expect(byYear.length).toBe(2)

      const y2025 = byYear.find((y) => y.year === 2025)!
      expect(y2025.totalMm).toBe(317.5)
      expect(y2025.rainyDays).toBe(6)
      expect(y2025.blossomRainMm).toBe(72.5) // 35.5 + 12 + 25
      expect(y2025.monsoonRainMm).toBe(200.0) // 120 + 80
      expect(y2025.wettestMonth.month).toBe(7) // July
      expect(y2025.wettestMonth.totalMm).toBe(200.0)
      expect(y2025.prevYearTotalMm).toBe(95.0)
      expect(y2025.yoyDifferenceMm).toBe(222.5)
      expect(y2025.yoyDifferencePercent).toBe(234.2)
      expect(y2025.monthlyBreakdown.length).toBe(12)
      expect(y2025.monthlyBreakdown[6].totalMm).toBe(200.0) // July
    })

    it('aggregates by month correctly with previous year comparisons', () => {
      const months = aggregateByMonth(mockDaily, 2025, 2024)
      expect(months.length).toBe(12)

      const march = months[2] // Index 2 is March
      expect(march.month).toBe(3)
      expect(march.totalMm).toBe(47.5)
      expect(march.prevYearTotalMm).toBe(0)
      expect(march.differenceMm).toBe(47.5)

      const july = months[6] // Index 6 is July
      expect(july.month).toBe(7)
      expect(july.totalMm).toBe(200.0)
      expect(july.prevYearTotalMm).toBe(95.0)
      expect(july.differenceMm).toBe(105.0)
      expect(july.differencePercent).toBe(110.5)
      expect(july.season).toBe('monsoon')
    })

    it('aggregates by day correctly with previous year comparisons', () => {
      const days = aggregateByDay(mockDaily, 2025, 7, 2024)
      expect(days.length).toBeGreaterThan(0)
      const day10 = days.find((d) => d.dayOfMonth === 10)!
      expect(day10.precipitationMm).toBe(0)
      expect(day10.prevYearPrecipitationMm).toBe(95.0)
      expect(day10.differenceMm).toBe(-95.0)

      const day12 = days.find((d) => d.dayOfMonth === 12)!
      expect(day12.precipitationMm).toBe(120.0)
      expect(day12.prevYearPrecipitationMm).toBe(0)
      expect(day12.differenceMm).toBe(120.0)
    })

    it('aggregates by week correctly', () => {
      const weeks = aggregateByWeek(mockDaily, 2025, 7, 2024)
      expect(weeks.length).toBe(1)
      expect(weeks[0].totalMm).toBe(200.0)
      expect(weeks[0].rainyDays).toBe(2)
      expect(weeks[0].prevYearTotalMm).toBe(95.0)
      expect(weeks[0].differenceMm).toBe(105.0)
    })
  })
})
