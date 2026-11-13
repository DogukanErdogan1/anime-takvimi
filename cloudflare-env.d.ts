declare namespace Cloudflare {
  interface Env {
    PUSH_PUBLIC_KEY?: string;
    PUSH_PRIVATE_KEY?: string;
    PUSH_SUBJECT?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
