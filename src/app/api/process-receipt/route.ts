import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { parseReceipt, type ParsedReceipt } from '@/lib/receipt-to-json';
import type { Database } from '@/lib/database.types';

// ─────────────────────────────────────────────────────────
// Supabase service-role client (server-side only)
// ─────────────────────────────────────────────────────────
function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─────────────────────────────────────────────────────────
// OpenAI client (lazy — only created when needed)
// ─────────────────────────────────────────────────────────
function createOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables.');
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─────────────────────────────────────────────────────────
// OpenAI Vision – structured JSON extraction prompt
// ─────────────────────────────────────────────────────────
const VISION_SYSTEM_PROMPT = `You are a UK HMRC-compliant receipt and invoice parsing assistant.
Extract ALL financial data from the provided image and return ONLY a JSON object.

Rules:
- Dates MUST be in DD/MM/YYYY format matching the UK locale.
- All monetary values MUST be in GBP (£), as decimal numbers (e.g. 12.50).
- VAT is the UK standard rate of 20%. If VAT is shown, use that figure. If not shown but "INC VAT" is stated on a total, calculate it as: vat = total / 6 (rounded to 2dp).
- service_charge is a separate optional charge (common in UK restaurants at 12.5%). Default 0 if not present.
- subtotal is the net amount before VAT.
- confidence is your 0–100 score for how accurately you could read the document.
- For line_items, extract every individual product/service line you can see.
- If a field cannot be determined, use null.

Return ONLY this JSON schema (no markdown, no explanation):
{
  "merchant_name": string | null,
  "receipt_date": string | null,
  "currency": "GBP",
  "subtotal": number | null,
  "vat_amount": number | null,
  "service_charge": number | null,
  "total_amount": number | null,
  "confidence": number,
  "line_items": [
    {
      "description": string,
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "category": string | null
    }
  ]
}`;

// ─────────────────────────────────────────────────────────
// Run OpenAI Vision on a base64-encoded image
// ─────────────────────────────────────────────────────────
async function extractReceiptWithVision(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ParsedReceipt> {
  const openai = createOpenAIClient();
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: VISION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
          {
            type: 'text',
            text: 'Extract the receipt data from this image following the rules above.',
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw);

  // Map the OpenAI output to our ParsedReceipt interface
  return {
    merchantName: parsed.merchant_name ?? null,
    receiptDate: normaliseDate(parsed.receipt_date),
    currency: 'GBP',
    subtotal: toNumber(parsed.subtotal),
    vatAmount: toNumber(parsed.vat_amount),
    serviceCharge: toNumber(parsed.service_charge),
    totalAmount: toNumber(parsed.total_amount),
    lineItems: (parsed.line_items ?? []).map(
      (item: {
        description?: string;
        quantity?: number;
        unit_price?: number;
        total_price?: number;
        category?: string;
      }) => ({
        description: item.description ?? 'Item',
        quantity: item.quantity ?? 1,
        unitPrice: toNumber(item.unit_price) ?? 0,
        totalPrice: toNumber(item.total_price) ?? 0,
        category: item.category ?? null,
      })
    ),
    confidence: Math.min(100, Math.max(0, Math.round(parsed.confidence ?? 90))),
    essentialsConfidence: Math.min(100, Math.max(0, Math.round(parsed.confidence ?? 95))),
    rawText: '',
  };
}

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/** Convert value to a rounded 2dp number, or null if invalid. */
function toNumber(val: unknown): number | null {
  const n = parseFloat(String(val));
  if (isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Normalise a date string to ISO-8601 (YYYY-MM-DD).
 * Accepts DD/MM/YYYY or YYYY-MM-DD from OpenAI output.
 */
function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // UK DD/MM/YYYY
  const ukMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const [, d, m, y] = ukMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// Auth helper
// ─────────────────────────────────────────────────────────
async function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const supabase = createServiceClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  return error || !user ? null : user;
}

// ─────────────────────────────────────────────────────────
// Save a fully-parsed receipt + line items to Supabase
// ─────────────────────────────────────────────────────────
async function saveReceiptToDb(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  imagePath: string,
  imageBuffer: Buffer,
  imageType: string,
  parsed: ParsedReceipt
): Promise<string | null> {
  // Upload image to private storage bucket
  await supabase.storage
    .from('receipt-images')
    .upload(imagePath, imageBuffer, { contentType: imageType, upsert: false });

  const { data: receipt, error } = await supabase
    .from('receipts')
    .insert({
      user_id: userId,
      merchant_name: parsed.merchantName,
      receipt_date: parsed.receiptDate,
      currency: parsed.currency,
      subtotal: parsed.subtotal,
      vat_amount: parsed.vatAmount,
      service_charge: parsed.serviceCharge,
      total_amount: parsed.totalAmount,
      confidence_score: parsed.confidence,
      status: parsed.confidence >= 90 ? 'verified' : 'needs_review',
      image_path: imagePath,
      raw_ocr_text: parsed.rawText || null,
      parsed_json: parsed as unknown as Record<string, unknown>,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Receipt insert error:', error);
    return null;
  }

  if (receipt && parsed.lineItems.length > 0) {
    await supabase.from('receipt_items').insert(
      parsed.lineItems.map((item) => ({
        receipt_id: receipt.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_price: item.totalPrice,
        category: item.category,
      }))
    );
  }

  return receipt?.id ?? null;
}

// ─────────────────────────────────────────────────────────
// Increment Cloud AI scan counter for a user
// ─────────────────────────────────────────────────────────
async function incrementUserScanCounter(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string
) {
  const { data } = await supabase
    .from('profiles')
    .select('ai_scans_used')
    .eq('id', userId)
    .single();

  if (data) {
    await supabase
      .from('profiles')
      .update({ ai_scans_used: data.ai_scans_used + 1 })
      .eq('id', userId);
  }
}

// ─────────────────────────────────────────────────────────
// Increment / upsert device scan counter
// ─────────────────────────────────────────────────────────
async function incrementDeviceScanCounter(
  supabase: ReturnType<typeof createServiceClient>,
  deviceId: string
) {
  const { data } = await supabase
    .from('device_usage')
    .select('free_scans_used')
    .eq('device_uuid', deviceId)
    .single();

  if (data) {
    await supabase
      .from('device_usage')
      .update({
        free_scans_used: data.free_scans_used + 1,
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

// ─────────────────────────────────────────────────────────
// POST /api/process-receipt
// ─────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const mode = (formData.get('mode') as string) || 'offline'; // 'offline' | 'cloud'
    const deviceId = formData.get('deviceId') as string | null;
    // rawText is set by the client when Tesseract (offline OCR) has already run
    const rawText = (formData.get('rawText') as string) || null;

    if (!imageFile) {
      return NextResponse.json(
        { error: 'NO_IMAGE', message: 'No image file provided.' },
        { status: 400 }
      );
    }

    const user = await getAuthUser(request);
    const supabase = createServiceClient();
    const isCloudMode = mode === 'cloud';

    // ─── Auth gate for Cloud AI ──────────────────────────
    if (isCloudMode && !user && !deviceId) {
      return NextResponse.json(
        {
          error: 'AUTH_REQUIRED',
          message: 'Log in to claim your 5 free Cloud AI scans.',
        },
        { status: 401 }
      );
    }

    // ─── Quota enforcement ───────────────────────────────
    if (isCloudMode) {
      if (user) {
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
                "You've used all 5 free Cloud AI scans on this device. Sign in or upgrade to Pro.",
              scansUsed,
              scansLimit: 5,
            },
            { status: 403 }
          );
        }
      }
    }

    // ─── Parse the receipt ───────────────────────────────
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    let parsed: ParsedReceipt;

    if (isCloudMode) {
      // Cloud AI: use OpenAI Vision on the actual image
      parsed = await extractReceiptWithVision(imageBuffer, imageFile.type || 'image/jpeg');
    } else {
      // Offline: rawText was extracted by Tesseract.js on the client side
      parsed = parseReceipt(rawText ?? '');
    }

    // ─── Persist to database (authenticated users only) ──
    let savedReceiptId: string | null = null;

    if (user) {
      const imagePath = `${user.id}/${Date.now()}-${imageFile.name}`;
      savedReceiptId = await saveReceiptToDb(
        supabase,
        user.id,
        imagePath,
        imageBuffer,
        imageFile.type || 'image/jpeg',
        parsed
      );
    }

    // ─── Increment counters ──────────────────────────────
    if (isCloudMode) {
      if (user) await incrementUserScanCounter(supabase, user.id);
      if (deviceId) await incrementDeviceScanCounter(supabase, deviceId);
    }

    // ─── Return structured response ──────────────────────
    return NextResponse.json({
      success: true,
      receipt: {
        id: savedReceiptId,
        merchant: parsed.merchantName,
        date: parsed.receiptDate,
        currency: parsed.currency,
        subtotal: parsed.subtotal,
        vat: parsed.vatAmount,
        serviceCharge: parsed.serviceCharge,
        total: parsed.totalAmount,
        confidence: parsed.confidence,
        status: parsed.confidence >= 90 ? 'verified' : 'needs_review',
        lineItems: parsed.lineItems,
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
