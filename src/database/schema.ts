import { sql } from 'drizzle-orm'
import { jsonb, pgTable, serial, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  plan: varchar('plan', { length: 32 }).notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pages = pgTable('pages', {
  uuid: uuid('uuid').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  blocks: jsonb('blocks').$type<unknown[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apps = pgTable('apps', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 8 }).notNull().unique().default(sql`substr(md5(random()::text || clock_timestamp()::text), 1, 8)`),
  alias: varchar('alias', { length: 120 }).notNull(),
  description: text('description').notNull().default(''),
})

export const apiDomains = pgTable('api_domains', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  alias: varchar('alias', { length: 120 }).notNull(),
  host: text('host').notNull().unique(),
})

export const apis = pgTable('apis', {
  uuid: varchar('uuid', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('draft'),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  layout: jsonb('layout').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const apisSnapshot = pgTable('apis_snapshot', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiUuid: varchar('api_uuid', { length: 128 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  method: varchar('method', { length: 16 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  apiJson: jsonb('api_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserRecord = typeof users.$inferSelect
export type NewUserRecord = typeof users.$inferInsert
export type PageRecord = typeof pages.$inferSelect
export type NewPageRecord = typeof pages.$inferInsert
export type AppRecord = typeof apps.$inferSelect
export type NewAppRecord = typeof apps.$inferInsert
export type ApiDomainRecord = typeof apiDomains.$inferSelect
export type NewApiDomainRecord = typeof apiDomains.$inferInsert
export type ApiRecord = typeof apis.$inferSelect
export type NewApiRecord = typeof apis.$inferInsert
export type ApiSnapshotRecord = typeof apisSnapshot.$inferSelect
export type NewApiSnapshotRecord = typeof apisSnapshot.$inferInsert
