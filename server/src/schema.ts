// Drizzle schema for the Custom Weather App.
//
// weather_cache: one row per location key ("lat,lon" rounded to 2dp) or the
// special "globe" key, holding the full normalized JSON payload the client
// renders plus when it was fetched. Readers serve the freshest row and the
// action refreshes it when older than 15 minutes.
//
// saved_locations: places the user bookmarked. The default place is a
// client-side constant, not a seeded row — this table starts empty and
// grows only by user action.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const weatherCache = sqliteTable("weather_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const savedLocations = sqliteTable("saved_locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  region: text("region").notNull().default(""),
  country: text("country").notNull().default(""),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  timezone: text("timezone").notNull().default("auto"),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
