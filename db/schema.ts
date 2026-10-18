import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
export const authAccounts = sqliteTable('auth_accounts', {
  userId:text('user_id').primaryKey().references(()=>members.id), email:text('email').notNull().unique(),
  passwordHash:text('password_hash').notNull(), passwordSalt:text('password_salt').notNull(),
  passwordAlgorithm:text('password_algorithm').notNull(), passwordParameters:text('password_parameters').notNull(),
  createdAt:text('created_at').notNull(),
}, table=>[
  check('auth_email_check',sql`length(${table.email}) BETWEEN 3 AND 254 AND ${table.email} = lower(${table.email})`),
  check('auth_password_parameters_check',sql`json_valid(${table.passwordParameters})`),
  check('auth_password_salt_check',sql`length(${table.passwordSalt}) = 64`),
]);
export const authSessions = sqliteTable('auth_sessions', {
  tokenHash:text('token_hash').primaryKey(), userId:text('user_id').notNull().references(()=>authAccounts.userId),
  createdAt:integer('created_at').notNull(), expiresAt:integer('expires_at').notNull(),
}, table=>[
  check('auth_token_hash_check',sql`length(${table.tokenHash}) = 64`),
  check('auth_session_expiry_check',sql`${table.expiresAt} > ${table.createdAt}`),
  index('auth_sessions_user_idx').on(table.userId),index('auth_sessions_expiry_idx').on(table.expiresAt),
]);
export const authRateLimits = sqliteTable('auth_rate_limits', {
  bucketKey:text('bucket_key').primaryKey(), resetAt:integer('reset_at').notNull(), attempts:integer('attempts').notNull(),
},table=>[check('auth_rate_attempts_check',sql`${table.attempts} >= 1`),index('auth_rate_expiry_idx').on(table.resetAt)]);
export const animeBanners = sqliteTable('anime_banners', {
  malId:integer('mal_id').primaryKey(),objectKey:text('object_key').notNull(),contentType:text('content_type').notNull(),
  updatedAt:text('updated_at').notNull(),updatedBy:text('updated_by').notNull().references(()=>members.id),
},table=>[
  check('banner_id_check',sql`${table.malId} BETWEEN 1 AND 2147483647`),
  check('banner_type_check',sql`${table.contentType} IN ('image/png','image/jpeg','image/webp')`),
]);
export const memberProfiles = sqliteTable('member_profiles', {
  userId:text('user_id').primaryKey().references(()=>members.id),
  bio:text('bio').notNull().default(''), isPublic:integer('is_public').notNull().default(0),
  updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
},table=>[
  check('profile_bio_check',sql`length(${table.bio}) <= 500`),
  check('profile_public_check',sql`${table.isPublic} IN (0,1)`),
]);
export const animeReviews = sqliteTable('anime_reviews', {
  id:text('id').primaryKey(), animeId:integer('anime_id').notNull(),
  userId:text('user_id').notNull().references(()=>members.id), body:text('body').notNull(),
  spoiler:integer('spoiler').notNull().default(0), score:integer('score'),
  createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  hidden:integer('hidden').notNull().default(0),
  hiddenBy:text('hidden_by').references(()=>members.id), hiddenAt:text('hidden_at'),
},table=>[
  check('review_anime_check',sql`${table.animeId} BETWEEN 1 AND 9999999999`),
  check('review_body_check',sql`length(trim(${table.body})) BETWEEN 1 AND 2000`),
  check('review_spoiler_check',sql`${table.spoiler} IN (0,1)`),
  check('review_score_check',sql`${table.score} IS NULL OR ${table.score} BETWEEN 1 AND 10`),
  check('review_hidden_check',sql`${table.hidden} IN (0,1)`),
  uniqueIndex('review_author_anime_idx').on(table.animeId,table.userId),
  index('reviews_visible_idx').on(table.animeId,table.hidden,table.createdAt,table.id),
]);
export const communityRateLimits = sqliteTable('community_rate_limits', {
  bucketKey:text('bucket_key').primaryKey(), resetAt:integer('reset_at').notNull(), attempts:integer('attempts').notNull(),
},table=>[check('community_rate_attempts_check',sql`${table.attempts} BETWEEN 1 AND 10`)]);
export const memberCovers = sqliteTable('member_covers', {
  userId:text('user_id').primaryKey().references(()=>members.id), objectKey:text('object_key').notNull(),
  contentType:text('content_type', {enum:['image/png','image/jpeg','image/webp']}).notNull(),
  updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
},table=>[
  check('cover_type_check',sql`${table.contentType} IN ('image/png','image/jpeg','image/webp')`),
  check('cover_key_check',sql`length(${table.objectKey}) = 107 AND substr(${table.objectKey},1,6) = 'cover/'`),
]);
export const memberProfileFrames = sqliteTable('member_profile_frames', {
  userId:text('user_id').primaryKey().references(()=>members.id),
  frameId:text('frame_id').notNull().default('none'),
  updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
},table=>[
  check('profile_frame_id_check',sql`${table.frameId} IN ('none','platin','yorunge','editor','kirik-halo','murekkep','panel','kristal','krom-akis','defne','krizantem','koi','yildiz-muhru')`),
]);
