declare namespace Cloudflare {
  interface Env {
    ANILIST_CLIENT_ID?: string;
    ANILIST_CLIENT_SECRET?: string;
    ANILIST_REDIRECT_URI?: string;
    ANILIST_ENCRYPTION_KEY?: string;
    PUSH_PUBLIC_KEY?: string;
    PUSH_PRIVATE_KEY?: string;
    PUSH_SUBJECT?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
