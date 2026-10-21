function roundToNiceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value))
  const fraction = value / power
  const niceFraction = fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10
  return niceFraction * power
}

export function getNetWorthDomain(values: readonly number[]): [number, number] {
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length === 0) return [0, 1]

  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  const range = max - min
  const magnitude = Math.max(Math.abs(min), Math.abs(max))
  const padding = range > 0 ? range * 0.1 : Math.max(magnitude * 0.005, 1)
  const step = roundToNiceStep(range > 0 ? range / 4 : Math.max(padding, magnitude * 0.05))
  const paddedMin = min - padding
  const lower = min >= 0 && paddedMin < 0 ? 0 : paddedMin
  const upper = max + padding

  return [Math.floor(lower / step) * step, Math.ceil(upper / step) * step]
}

export function formatNetWorthAxisTick(
  value: number,
  domain: readonly [number, number],
  currency = 'USD',
  locale = 'en-US',
): string {
  if (value === 0) return '0'

  const tickInterval = (domain[1] - domain[0]) / 4
  const magnitude = Math.abs(value)
  const compactUnit = magnitude >= 1_000_000 ? 1_000_000 : magnitude >= 1_000 ? 1_000 : 1
  if (tickInterval < compactUnit / 10) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function shouldFillNetWorthArea(domain: readonly [number, number]): boolean {
  return domain[0] <= 0 && domain[1] >= 0
}
