export function getNetWorthDomain(values: readonly number[]): [number, number] {
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length === 0) return [0, 1]

  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  const range = max - min
  const padding = range > 0 ? range * 0.1 : Math.max(Math.abs(max) * 0.005, 1)

  return [min >= 0 ? Math.max(0, min - padding) : min - padding, max + padding]
}
