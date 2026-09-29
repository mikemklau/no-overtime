export type SubscriptionTier = 'free' | 'pro';
export type ReceiptStatus = 'needs_review' | 'verified' | 'exported';

export interface Profile {
  id: string;
  email: string | null;
  subscription_tier: SubscriptionTier;
  ai_scans_used: number;
  ai_scans_limit: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceUsage {
  device_uuid: string;
  free_scans_used: number;
  last_seen: string;
}

export interface Receipt {
  id: string;
  user_id: string;
  merchant_name: string | null;
  receipt_date: string | null;
  currency: string;
  subtotal: number | null;
  vat_amount: number | null;
  service_charge: number | null;
  total_amount: number | null;
  confidence_score: number | null;
  status: ReceiptStatus;
  image_path: string | null;
  raw_ocr_text: string | null;
  parsed_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptItem {
  id: string;
  receipt_id: string;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  category: string | null;
  created_at: string;
}

/**
 * Supabase Database type definitions.
 * Used with createClient<Database>() for type-safe queries.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & Pick<Profile, 'id'>;
        Update: Partial<Omit<Profile, 'id'>>;
      };
      device_usage: {
        Row: DeviceUsage;
        Insert: Partial<DeviceUsage> & Pick<DeviceUsage, 'device_uuid'>;
        Update: Partial<Omit<DeviceUsage, 'device_uuid'>>;
      };
      receipts: {
        Row: Receipt;
        Insert: Partial<Receipt> & Pick<Receipt, 'user_id'>;
        Update: Partial<Omit<Receipt, 'id' | 'user_id'>>;
      };
      receipt_items: {
        Row: ReceiptItem;
        Insert: Partial<ReceiptItem> & Pick<ReceiptItem, 'receipt_id'>;
        Update: Partial<Omit<ReceiptItem, 'id' | 'receipt_id'>>;
      };
    };
  };
}
