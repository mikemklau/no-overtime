import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseReceipt } from '@/lib/receipt-to-json';
import type { Database } from '@/lib/database.types';

// Server-side Supabase client with service role for quota enforcement
function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Extract user from the Authorization header (Supabase JWT).
 * Returns null if no valid session.
 */
async function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const supabase = createServiceClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  return user;
}

// ─────────────────────────────────────────────────────────
// POST /api/process-receipt
// ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const imageFile = formData.get('image') as File | null;
    const mode = (formData.get('mode') as string) || 'auto'; // 'auto' | 'offline' | 'cloud'
    const deviceId = formData.get('deviceId') as string | null;

    if (!imageFile) {
      return NextResponse.json(
        { error: 'NO_IMAGE', message: 'No image file provided.' },
        { status: 400 }
      );
    }

    // ─── Authentication Check ────────────────────────────
    const user = await getAuthUser(request);
    const supabase = createServiceClient();

    const isCloudMode = mode === 'cloud' || mode === 'auto';

    // If Cloud AI is requested but no auth and no device ID → 401
    if (isCloudMode && !user && !deviceId) {
      return NextResponse.json(
        {
          error: 'AUTH_REQUIRED',
          message: 'Log in to claim your 5 free Cloud AI scans.',
        },
        { status: 401 }
      );
    }

    // ─── Quota Enforcement ───────────────────────────────
    if (isCloudMode) {
      if (user) {
        // Check user profile quota
        const { data: profile } = await supabase
          .from('profiles')
          .select('subscription_tier, ai_scans_used, ai_scans_limit')
          .eq('id', user.id)
          .single();

        if (
          profile &&
          profile.subscription_tier === 'free' &&
          profile.ai_scans_used >= profile.ai_scans_limit
        ) {
          return NextResponse.json(
            {
              error: 'QUOTA_EXCEEDED',
              message: `You've used all ${profile.ai_scans_limit} free Cloud AI scans. Upgrade to Pro for unlimited scans.`,
              scansUsed: profile.ai_scans_used,
              scansLimit: profile.ai_scans_limit,
            },
            { status: 403 }
          );
        }
      } else if (deviceId) {
        // Check device usage quota
        const { data: device } = await supabase
          .from('device_usage')
          .select('free_scans_used')
          .eq('device_uuid', deviceId)
          .single();

        const scansUsed = device?.free_scans_used ?? 0;

        if (scansUsed >= 5) {
          return NextResponse.json(
            {
              error: 'QUOTA_EXCEEDED',
              message:
                "You've used all 5 free Cloud AI scans on this device. Sign in to manage your account or upgrade to Pro.",
              scansUsed,
              scansLimit: 5,
            },
            { status: 403 }
          );
        }
      }
    }

    // ─── Process the Receipt ─────────────────────────────
    // Read the image as a buffer (for future OCR / OpenAI Vision)
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

    // TODO: Replace with actual OCR (Tesseract.js) or OpenAI Vision call.
    // For now, accept rawText in the form data for testing.
    const rawText = (formData.get('rawText') as string) || '';

    const parsedReceipt = parseReceipt(rawText);

    // ─── Save to Database ────────────────────────────────
    let savedReceiptId: string | null = null;

    if (user) {
      // Upload image to private storage bucket
      const imagePath = `${user.id}/${Date.now()}-${imageFile.name}`;

      await supabase.storage
        .from('receipt-images')
        .upload(imagePath, imageBuffer, {
          contentType: imageFile.type,
          upsert: false,
        });

      // Insert receipt record
      const { data: receipt, error: insertError } = await supabase
        .from('receipts')
        .insert({
          user_id: user.id,
          merchant_name: parsedReceipt.merchantName,
          receipt_date: parsedReceipt.receiptDate,
          currency: parsedReceipt.currency,
          subtotal: parsedReceipt.subtotal,
          vat_amount: parsedReceipt.vatAmount,
          service_charge: parsedReceipt.serviceCharge,
          total_amount: parsedReceipt.totalAmount,
          confidence_score: parsedReceipt.confidence,
          status:
            parsedReceipt.confidence >= 90 ? 'verified' : 'needs_review',
          image_path: imagePath,
          raw_ocr_text: parsedReceipt.rawText,
          parsed_json:
            parsedReceipt as unknown as Record<string, unknown>,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Failed to save receipt:', insertError);
      } else if (receipt) {
        savedReceiptId = receipt.id;

        // Insert line items
        if (parsedReceipt.lineItems.length > 0) {
          await supabase.from('receipt_items').insert(
            parsedReceipt.lineItems.map((item) => ({
              receipt_id: receipt.id,
              description: item.description,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              total_price: item.totalPrice,
              category: item.category,
            }))
          );
        }
      }

      // Increment AI scan counter (if cloud mode)
      if (isCloudMode) {
        const { data: currentProfile } = await supabase
          .from('profiles')
          .select('ai_scans_used')
          .eq('id', user.id)
          .single();

        if (currentProfile) {
          await supabase
            .from('profiles')
            .update({
              ai_scans_used: currentProfile.ai_scans_used + 1,
            })
            .eq('id', user.id);
        }
      }
    }

    // Increment device scan counter (if cloud mode + device ID)
    if (isCloudMode && deviceId) {
      const { data: existing } = await supabase
        .from('device_usage')
        .select('free_scans_used')
        .eq('device_uuid', deviceId)
        .single();

      if (existing) {
        await supabase
          .from('device_usage')
          .update({
            free_scans_used: existing.free_scans_used + 1,
            last_seen: new Date().toISOString(),
          })
          .eq('device_uuid', deviceId);
      } else {
        await supabase.from('device_usage').insert({
          device_uuid: deviceId,
          free_scans_used: 1,
          last_seen: new Date().toISOString(),
        });
      }
    }

    // ─── Return Response ─────────────────────────────────
    return NextResponse.json({
      success: true,
      receipt: {
        id: savedReceiptId,
        merchant: parsedReceipt.merchantName,
        date: parsedReceipt.receiptDate,
        currency: parsedReceipt.currency,
        subtotal: parsedReceipt.subtotal,
        vat: parsedReceipt.vatAmount,
        serviceCharge: parsedReceipt.serviceCharge,
        total: parsedReceipt.totalAmount,
        confidence: parsedReceipt.confidence,
        status:
          parsedReceipt.confidence >= 90 ? 'verified' : 'needs_review',
        lineItems: parsedReceipt.lineItems,
      },
    });
  } catch (error) {
    console.error('process-receipt error:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to process receipt.' },
      { status: 500 }
    );
  }
}
