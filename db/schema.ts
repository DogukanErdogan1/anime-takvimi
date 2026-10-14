import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const members = sqliteTable('members', {
  id: text('id').primaryKey(), email: text('email').notNull(), displayName: text('display_name').notNull(),
  role: text('role', {enum: ['admin','member']}).notNull().default('member'),
  status: text('status', {enum: ['active','suspended']}).notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  check('members_role_check', sql`${table.role} IN ('admin','member')`),
  check('members_status_check', sql`${table.status} IN ('active','suspended')`),
  check('members_name_check', sql`length(${table.displayName}) BETWEEN 2 AND 40`),
  index('members_created_idx').on(table.createdAt, table.id), index('members_email_idx').on(table.email),
  uniqueIndex('members_single_admin').on(table.role).where(sql`${table.role} = 'admin'`),
]);
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(), value: text('value').notNull(),
}, table => [check('settings_key_check', sql`${table.key} = 'admin_owner'`)]);
export const memberLibraries = sqliteTable('member_libraries', {
  userId: text('user_id').primaryKey().references(() => members.id), libraryJson: text('library_json').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [check('library_json_check', sql`json_valid(${table.libraryJson}) AND length(${table.libraryJson}) <= 1048576`)]);
export const adminAudit = sqliteTable('admin_audit', {
  id: text('id').primaryKey(), actorId: text('actor_id').notNull().references(() => members.id),
  targetId: text('target_id').notNull().references(() => members.id), action: text('action').notNull(),
  metadataJson: text('metadata_json').notNull(), createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  check('audit_action_check', sql`${table.action} = 'member_status'`),
  check('audit_metadata_check', sql`json_valid(${table.metadataJson}) AND length(${table.metadataJson}) <= 512`),
  index('audit_created_idx').on(table.createdAt),
]);
export const memberAvatars = sqliteTable('member_avatars', {
  userId: text('user_id').primaryKey().references(() => members.id),
  objectKey: text('object_key').notNull(),
  contentType: text('content_type', {enum:['image/png','image/jpeg','image/webp']}).notNull(),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [
  check('avatar_type_check', sql`${table.contentType} IN ('image/png','image/jpeg','image/webp')`),
  check('avatar_key_check', sql`length(${table.objectKey}) = 108 AND substr(${table.objectKey},1,7) = 'avatar/'`),
]);
