import { describe, expect, it } from 'vitest'
import { getNetWorthDomain } from './net-worth-chart-utils'

describe('getNetWorthDomain', () => {
  it('zooms in around large positive net worth values', () => {
    expect(getNetWorthDomain([995_000, 1_005_000])).toEqual([994_000, 1_006_000])
  })

  it('keeps zero in range when positive values are close to zero', () => {
    expect(getNetWorthDomain([2, 100])).toEqual([0, 109.8])
  })

  it('adds padding around negative and positive values', () => {
    expect(getNetWorthDomain([-100, 100])).toEqual([-120, 120])
  })

  it('pads a constant series so the chart still has a usable scale', () => {
    expect(getNetWorthDomain([1_000_000, 1_000_000])).toEqual([995_000, 1_005_000])
  })

  it('falls back to a valid range when there are no finite values', () => {
    expect(getNetWorthDomain([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([0, 1])
  })
})
