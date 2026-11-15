import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
  spoiler:integer('spoiler').notNull().default(0), score:integer('score'), episode:integer('episode'),
  createdAt:text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt:text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  hidden:integer('hidden').notNull().default(0),
  hiddenBy:text('hidden_by').references(()=>members.id), hiddenAt:text('hidden_at'),
},table=>[
  check('review_anime_check',sql`${table.animeId} BETWEEN 1 AND 9999999999`),
  check('review_body_check',sql`length(trim(${table.body})) BETWEEN 1 AND 2000`),
  check('review_spoiler_check',sql`${table.spoiler} IN (0,1)`),
  check('review_episode_check',sql`${table.episode} IS NULL OR (typeof(${table.episode})='integer' AND ${table.episode} BETWEEN 1 AND 9999 AND ${table.spoiler}=1)`),
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

export const reviewReports = sqliteTable('review_reports', {
 id:text('id').primaryKey(),reviewId:text('review_id').notNull().references(()=>animeReviews.id),reporterId:text('reporter_id').notNull().references(()=>members.id),
 reason:text('reason',{enum:['spoiler','abuse','spam','other']}).notNull(),detail:text('detail').notNull().default(''),status:text('status',{enum:['open','dismissed','removed']}).notNull().default('open'),createdAt:text('created_at').notNull(),resolvedAt:text('resolved_at'),resolvedBy:text('resolved_by').references(()=>members.id),
},table=>[uniqueIndex('review_reports_author').on(table.reviewId,table.reporterId),index('review_reports_queue').on(table.status,table.createdAt)]);

export const pushSubscriptions = sqliteTable('push_subscriptions', {
 endpointHash:text('endpoint_hash').primaryKey(),userId:text('user_id').notNull().references(()=>members.id),subscriptionJson:text('subscription_json').notNull(),createdAt:text('created_at').notNull(),deviceHash:text('device_hash'),bindingId:text('binding_id'),sessionHash:text('session_hash').references(()=>authSessions.tokenHash,{onDelete:'cascade'}),
},table=>[index('push_subscriptions_user').on(table.userId),index('push_session_idx').on(table.sessionHash),uniqueIndex('push_device_unique').on(table.deviceHash)]);
export const pushDeliveries = sqliteTable('push_deliveries', {
 endpointHash:text('endpoint_hash').notNull().references(()=>pushSubscriptions.endpointHash,{onDelete:'cascade'}),occurrence:text('occurrence').notNull(),status:text('status',{enum:['sending','sent','failed']}).notNull(),claimedAt:integer('claimed_at').notNull(),attempts:integer('attempts').notNull().default(1),
},table=>[primaryKey({columns:[table.endpointHash,table.occurrence]})]);

export const watchClubs=sqliteTable('watch_clubs',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull().references(()=>members.id),title:text('title').notNull(),createdAt:text('created_at').notNull(),
},table=>[check('watch_club_title',sql`length(trim(${table.title})) BETWEEN 1 AND 80`),index('watch_clubs_owner').on(table.ownerId)]);
export const watchClubMembers=sqliteTable('watch_club_members',{
 clubId:text('club_id').notNull().references(()=>watchClubs.id,{onDelete:'cascade'}),userId:text('user_id').notNull().references(()=>members.id),joinedAt:text('joined_at').notNull(),
},table=>[primaryKey({columns:[table.clubId,table.userId]}),index('watch_club_user').on(table.userId)]);
export const watchClubEntries=sqliteTable('watch_club_entries',{
 clubId:text('club_id').notNull().references(()=>watchClubs.id,{onDelete:'cascade'}),animeId:integer('anime_id').notNull(),animeJson:text('anime_json').notNull(),addedBy:text('added_by').notNull().references(()=>members.id),createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.clubId,table.animeId]}),check('watch_club_anime',sql`${table.animeId} BETWEEN 1 AND 2147483647`),check('watch_club_json',sql`json_valid(${table.animeJson}) AND length(${table.animeJson})<=4096`)]);
export const watchClubVotes=sqliteTable('watch_club_votes',{
 clubId:text('club_id').notNull(),userId:text('user_id').notNull(),animeId:integer('anime_id').notNull(),
},table=>[primaryKey({columns:[table.clubId,table.userId]}),foreignKey({columns:[table.clubId,table.userId],foreignColumns:[watchClubMembers.clubId,watchClubMembers.userId]}).onDelete('cascade'),foreignKey({columns:[table.clubId,table.animeId],foreignColumns:[watchClubEntries.clubId,watchClubEntries.animeId]}).onDelete('cascade')]);
export const watchClubInvites=sqliteTable('watch_club_invites',{
 clubId:text('club_id').primaryKey().references(()=>watchClubs.id,{onDelete:'cascade'}),tokenHash:text('token_hash').notNull().unique(),expiresAt:integer('expires_at').notNull(),
},table=>[check('watch_club_token',sql`length(${table.tokenHash})=64`)]);

export const anilistConnections=sqliteTable('anilist_connections',{
 userId:text('user_id').primaryKey().references(()=>members.id),anilistId:integer('anilist_id').notNull().unique(),displayName:text('display_name').notNull(),tokenCipher:text('token_cipher').notNull(),expiresAt:integer('expires_at').notNull(),generation:text('generation').notNull(),connectedAt:integer('connected_at').notNull(),rateReset:integer('rate_reset').notNull().default(0),rateCount:integer('rate_count').notNull().default(0),
});
export const anilistOauthStates=sqliteTable('anilist_oauth_states',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>members.id),sessionHash:text('session_hash').notNull().references(()=>authSessions.tokenHash,{onDelete:'cascade'}),expiresAt:integer('expires_at').notNull(),used:integer('used').notNull().default(0),
},table=>[index('anilist_states_user').on(table.userId,table.expiresAt),check('anilist_state_used',sql`${table.used} IN (0,1)`)]);
export const anilistSyncPlans=sqliteTable('anilist_sync_plans',{
 id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>anilistConnections.userId,{onDelete:'cascade'}),generation:text('generation').notNull(),direction:text('direction',{enum:['import','export']}).notNull(),libraryRevision:text('library_revision').notNull(),dataJson:text('data_json').notNull(),expiresAt:integer('expires_at').notNull(),lockedUntil:integer('locked_until').notNull().default(0),lease:text('lease'),
},table=>[index('anilist_plans_user').on(table.userId,table.expiresAt),check('anilist_plan_direction',sql`${table.direction} IN ('import','export')`),check('anilist_plan_json',sql`json_valid(${table.dataJson})`)]);
