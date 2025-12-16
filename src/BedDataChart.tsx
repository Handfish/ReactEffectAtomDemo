import { useMemo, useState, useEffect } from 'react'
import { useAtomValue, useAtomRefresh } from '@effect-atom/atom-react'
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
} from 'recharts'
import { bedDataAtom, BedDataPoint } from '@/data-access/bed-data-atom'

// LTTB (Largest Triangle Three Buckets) downsampling algorithm
function downsampleLTTB<T extends { temperatureF: number }>(
  data: T[],
  threshold: number,
  valueKey: keyof T
): T[] {
  if (data.length <= threshold) return data
  if (data.length === 0) return []
  if (threshold < 3) return [data[0], data[data.length - 1]]

  const sampled: T[] = []
  const bucketSize = (data.length - 2) / (threshold - 2)

  sampled.push(data[0])

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1)
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length)
    const avgRangeLength = Math.max(avgRangeEnd - avgRangeStart, 1)

    let avgX = 0
    let avgY = 0
    for (let j = avgRangeStart; j < avgRangeEnd && j < data.length; j++) {
      avgX += j
      avgY += data[j][valueKey] as number
    }
    avgX /= avgRangeLength
    avgY /= avgRangeLength

    const rangeStart = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1)
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1)

    const pointBefore = sampled[sampled.length - 1]
    let maxArea = -1
    let maxAreaIndex = rangeStart

    for (let j = rangeStart; j < rangeEnd && j < data.length; j++) {
      const area = Math.abs(
        ((pointBefore[valueKey] as number) - avgY) * (j - sampled.length + 1) +
          (avgX - sampled.length + 1) * ((data[j][valueKey] as number) - (pointBefore[valueKey] as number))
      )
      if (area > maxArea) {
        maxArea = area
        maxAreaIndex = j
      }
    }

    sampled.push(data[maxAreaIndex])
  }

  sampled.push(data[data.length - 1])

  return sampled
}

interface ChartDataPoint {
  timestamp: string
  time: string
  temperatureF: number
  relativeHumidity: number
  originalIndex: number
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartDataPoint; dataKey: string; color: string }>
}) {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    return (
      <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-6">
        <p className="text-2xl font-medium text-black mb-3">{data.time}</p>
        <p className="text-xl text-orange-600">
          Temperature: <span className="font-semibold">{data.temperatureF.toFixed(1)}</span> °F
        </p>
        <p className="text-xl text-blue-600">
          Humidity: <span className="font-semibold">{data.relativeHumidity.toFixed(1)}</span> %
        </p>
      </div>
    )
  }
  return null
}

export function BedDataChart() {
  const bedDataResult = useAtomValue(bedDataAtom)
  const refreshBedData = useAtomRefresh(bedDataAtom)

  const [zoomDomain, setZoomDomain] = useState<{ left: number; right: number } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionArea, setSelectionArea] = useState<{ startIndex: number; endIndex: number } | null>(null)
  const [axisHighlight, setAxisHighlight] = useState(false)

  useEffect(() => {
    if (zoomDomain !== null) {
      setAxisHighlight(true)
      const timer = setTimeout(() => setAxisHighlight(false), 800)
      return () => clearTimeout(timer)
    }
  }, [zoomDomain])

  const fullChartData = useMemo(() => {
    if (bedDataResult._tag !== 'Success') return []

    return bedDataResult.value.records.map((record, index) => {
      const timePart = record.timestamp.split(' ')[1] || record.timestamp
      return {
        timestamp: record.timestamp,
        time: timePart,
        temperatureF: record.temperatureF,
        relativeHumidity: record.relativeHumidity,
        originalIndex: index,
      }
    })
  }, [bedDataResult])

  const zoomedData = useMemo(() => {
    if (!zoomDomain) return fullChartData
    return fullChartData.slice(zoomDomain.left, zoomDomain.right + 1)
  }, [fullChartData, zoomDomain])

  const chartData = useMemo(() => {
    const threshold = 150
    if (zoomedData.length <= threshold) {
      return zoomedData
    }
    return downsampleLTTB(zoomedData, threshold, 'temperatureF')
  }, [zoomedData])

  const isDownsampled = zoomedData.length > 150

  const stats = useMemo(() => {
    if (chartData.length === 0) return null

    const temps = chartData.map((d) => d.temperatureF)
    const humidities = chartData.map((d) => d.relativeHumidity)

    return {
      temp: {
        min: Math.min(...temps),
        max: Math.max(...temps),
        avg: temps.reduce((a, b) => a + b, 0) / temps.length,
      },
      humidity: {
        min: Math.min(...humidities),
        max: Math.max(...humidities),
        avg: humidities.reduce((a, b) => a + b, 0) / humidities.length,
      },
    }
  }, [chartData])

  if (bedDataResult._tag === 'Initial') {
    return (
      <div className="bg-white rounded-lg shadow-md border border-gray-300 p-12">
        <div className="animate-pulse">
          <div className="h-12 bg-gray-200 rounded w-64 mb-6"></div>
          <div className="h-96 bg-gray-100 rounded"></div>
        </div>
      </div>
    )
  }

  if (bedDataResult._tag === 'Failure') {
    return (
      <div className="bg-white rounded-lg shadow-md border border-gray-300 p-12">
        <h3 className="text-4xl font-semibold text-black mb-6">Bedroom Environment</h3>
        <div className="text-center py-12 text-red-600">
          <span className="text-7xl mb-4 block">⚠️</span>
          <p className="text-2xl">Failed to load data</p>
          <button
            onClick={() => refreshBedData()}
            className="mt-6 px-8 py-4 text-xl bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md border border-gray-300 p-12">
        <h3 className="text-4xl font-semibold text-black mb-6">Bedroom Environment</h3>
        <div className="text-center py-12 text-gray-700">
          <span className="text-7xl mb-4 block">📉</span>
          <p className="text-2xl">No data available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-300 p-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-6">
          <h3 className="text-4xl font-semibold text-black">Bedroom Environment</h3>
          {isDownsampled && (
            <span className="px-4 py-2 text-lg bg-blue-100 text-blue-700 rounded">
              Showing {chartData.length} of {zoomedData.length} points
            </span>
          )}
          {zoomDomain && (
            <button
              onClick={() => setZoomDomain(null)}
              className="px-6 py-3 text-lg bg-blue-500 hover:bg-blue-600 text-white rounded font-medium transition-colors shadow-sm"
            >
              ↺ Reset Zoom
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xl text-gray-700">{fullChartData.length} total readings</span>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-8 mb-10">
          <div className="bg-white border border-orange-200 rounded-lg p-6">
            <div className="text-xl text-orange-600 font-medium mb-4">Temperature (°F)</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg text-gray-700">Min</div>
                <div className="text-3xl font-bold text-orange-700">{stats.temp.min.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-lg text-gray-700">Avg</div>
                <div className="text-3xl font-bold text-orange-700">{stats.temp.avg.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-lg text-gray-700">Max</div>
                <div className="text-3xl font-bold text-orange-700">{stats.temp.max.toFixed(1)}</div>
              </div>
            </div>
          </div>
          <div className="bg-white border border-blue-200 rounded-lg p-6">
            <div className="text-xl text-blue-600 font-medium mb-4">Relative Humidity (%)</div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg text-gray-700">Min</div>
                <div className="text-3xl font-bold text-blue-700">{stats.humidity.min.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-lg text-gray-700">Avg</div>
                <div className="text-3xl font-bold text-blue-700">{stats.humidity.avg.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-lg text-gray-700">Max</div>
                <div className="text-3xl font-bold text-blue-700">{stats.humidity.max.toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative" style={{ width: '100%', height: '500px' }}>
        <style>
          {`
            @keyframes axis-fade-blue {
              0% { fill: #374151; }
              50% { fill: #3b82f6; font-weight: 600; }
              100% { fill: #374151; }
            }
            .axis-highlight .recharts-cartesian-axis-tick-value {
              animation: axis-fade-blue 0.6s ease-in-out 1;
            }
          `}
        </style>
        {!zoomDomain && (
          <div className="absolute top-4 right-4 z-10 text-lg text-gray-700 bg-white px-4 py-2 rounded border border-gray-300">
            Click and drag to zoom
          </div>
        )}
        {isSelecting && selectionArea && chartData.length > 0 && (
          <>
            {(() => {
              const startIdx = Math.min(selectionArea.startIndex, selectionArea.endIndex)
              const endIdx = Math.max(selectionArea.startIndex, selectionArea.endIndex)
              const totalPoints = chartData.length

              const leftMargin = 70
              const rightMargin = 70
              const chartWidth = `calc(100% - ${leftMargin + rightMargin}px)`

              const startPercent = (startIdx / (totalPoints - 1)) * 100
              const endPercent = (endIdx / (totalPoints - 1)) * 100
              const widthPercent = endPercent - startPercent

              return (
                <>
                  <div
                    className="absolute top-0 bottom-0 bg-blue-400/40 border-l-2 border-r-2 border-blue-600 pointer-events-none z-20"
                    style={{
                      left: `calc(${leftMargin}px + ${chartWidth} * ${startPercent / 100})`,
                      width: `calc(${chartWidth} * ${widthPercent / 100})`,
                    }}
                  />
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 text-xl font-semibold text-blue-900 bg-white px-6 py-3 rounded-lg border-2 border-blue-600 shadow-lg">
                    {chartData[startIdx]?.time} → {chartData[endIdx]?.time}
                  </div>
                </>
              )
            })()}
          </>
        )}
        <ResponsiveContainer width="100%" height={500} className={axisHighlight ? 'axis-highlight' : ''}>
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 60, left: 20, bottom: 0 }}
            style={{ cursor: isSelecting ? 'col-resize' : 'crosshair' }}
            onMouseDown={(e: any) => {
              if (e && e.activeLabel) {
                const index = chartData.findIndex((d) => d.time === e.activeLabel)
                if (index !== -1) {
                  setIsSelecting(true)
                  setSelectionArea({ startIndex: index, endIndex: index })
                }
              }
            }}
            onMouseMove={(e: any) => {
              if (isSelecting && e && e.activeLabel) {
                const index = chartData.findIndex((d) => d.time === e.activeLabel)
                if (index !== -1 && selectionArea) {
                  setSelectionArea({ ...selectionArea, endIndex: index })
                }
              }
            }}
            onMouseUp={() => {
              if (isSelecting && selectionArea) {
                const left = Math.min(selectionArea.startIndex, selectionArea.endIndex)
                const right = Math.max(selectionArea.startIndex, selectionArea.endIndex)

                if (right - left > chartData.length * 0.05) {
                  setZoomDomain({
                    left: chartData[left].originalIndex,
                    right: chartData[right].originalIndex,
                  })
                }
              }
              setIsSelecting(false)
              setSelectionArea(null)
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 20, fill: '#374151' }}
              tickLine={{ stroke: '#9ca3af' }}
              axisLine={{ stroke: '#9ca3af' }}
            />
            <YAxis
              yAxisId="temp"
              orientation="left"
              domain={stats ? [stats.temp.min - 0.5, stats.temp.max + 0.5] : ['auto', 'auto']}
              tick={{ fontSize: 20, fill: '#ea580c' }}
              tickLine={{ stroke: '#9ca3af' }}
              axisLine={{ stroke: '#9ca3af' }}
              label={{
                value: '°F',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 24, fill: '#ea580c' },
              }}
            />
            <YAxis
              yAxisId="humidity"
              orientation="right"
              domain={stats ? [stats.humidity.min - 0.5, stats.humidity.max + 0.5] : ['auto', 'auto']}
              tick={{ fontSize: 20, fill: '#2563eb' }}
              tickLine={{ stroke: '#9ca3af' }}
              axisLine={{ stroke: '#9ca3af' }}
              label={{
                value: '%',
                angle: 90,
                position: 'insideRight',
                style: { fontSize: 24, fill: '#2563eb' },
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 20 }} />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="temperatureF"
              name="Temperature"
              stroke="#ea580c"
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="humidity"
              type="monotone"
              dataKey="relativeHumidity"
              name="Humidity"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xl text-gray-600 mt-8 text-center">
        Bedroom temperature and humidity readings
      </p>
    </div>
  )
}
