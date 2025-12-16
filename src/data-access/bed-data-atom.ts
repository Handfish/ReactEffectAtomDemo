import { Atom } from "@effect-atom/atom-react";
import { Effect } from "effect";
import { appRuntime } from "@/lib/app-runtime";

export interface BedDataPoint {
  timestamp: string;
  temperatureF: number;
  relativeHumidity: number;
}

// Effect atom that loads and parses the bed.csv file
export const bedDataAtom = appRuntime
  .atom(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch("/src/bed.csv"),
        catch: () => new Error("Failed to fetch bed.csv"),
      });

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error("Failed to read CSV content"),
      });

      const lines = text.trim().split("\n");
      // Skip header row
      const dataLines = lines.slice(1);

      const records: BedDataPoint[] = dataLines
        .map((line) => {
          const [timestamp, tempStr, humidityStr] = line.split(",");
          const temperatureF = parseFloat(tempStr);
          const relativeHumidity = parseFloat(humidityStr);

          if (isNaN(temperatureF) || isNaN(relativeHumidity)) {
            return null;
          }

          return {
            timestamp: timestamp.trim(),
            temperatureF,
            relativeHumidity,
          };
        })
        .filter((record): record is BedDataPoint => record !== null);

      return { records };
    }),
  )
  .pipe(Atom.keepAlive);
