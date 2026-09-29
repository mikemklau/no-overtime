import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '../database.types';

/**
 * Creates a Supabase client for use in Client Components.
 * Uses @supabase/ssr for cookie-based auth (works with Next.js App Router).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
