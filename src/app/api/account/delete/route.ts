import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Service role client to perform administrative user deletion
function createServiceClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase environment variables are missing.');
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Missing or invalid authorization token.' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const supabaseAdmin = createServiceClient();

    // Verify token to get user ID
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Session expired or invalid user token.' },
        { status: 401 }
      );
    }

    const userId = user.id;

    // Delete user from auth.users (cascades to public.profiles, public.receipts, and triggers storage cleanup)
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('Failed to delete user account:', deleteError);
      return NextResponse.json(
        { error: 'DELETE_FAILED', message: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Account and all associated GDPR financial data permanently deleted.',
    });
  } catch (err: unknown) {
    console.error('Account deletion endpoint error:', err);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown server error during account deletion.',
      },
      { status: 500 }
    );
  }
}
