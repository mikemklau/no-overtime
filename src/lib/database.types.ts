/**
 * Supabase Database type definitions.
 * Matches the schema created in 00001_initial_schema.sql.
 *
 * Used with createClient<Database>() for type-safe queries.
 */

export type SubscriptionTier = 'free' | 'pro';
export type ReceiptStatus = 'needs_review' | 'verified' | 'exported';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          subscription_tier: SubscriptionTier;
          ai_scans_used: number;
          ai_scans_limit: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          subscription_tier?: SubscriptionTier;
          ai_scans_used?: number;
          ai_scans_limit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          subscription_tier?: SubscriptionTier;
          ai_scans_used?: number;
          ai_scans_limit?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      device_usage: {
        Row: {
          device_uuid: string;
          free_scans_used: number;
          last_seen: string;
        };
        Insert: {
          device_uuid: string;
          free_scans_used?: number;
          last_seen?: string;
        };
        Update: {
          device_uuid?: string;
          free_scans_used?: number;
          last_seen?: string;
        };
        Relationships: [];
      };
      receipts: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          merchant_name?: string | null;
          receipt_date?: string | null;
          currency?: string;
          subtotal?: number | null;
          vat_amount?: number | null;
          service_charge?: number | null;
          total_amount?: number | null;
          confidence_score?: number | null;
          status?: ReceiptStatus;
          image_path?: string | null;
          raw_ocr_text?: string | null;
          parsed_json?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          merchant_name?: string | null;
          receipt_date?: string | null;
          currency?: string;
          subtotal?: number | null;
          vat_amount?: number | null;
          service_charge?: number | null;
          total_amount?: number | null;
          confidence_score?: number | null;
          status?: ReceiptStatus;
          image_path?: string | null;
          raw_ocr_text?: string | null;
          parsed_json?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipts_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      receipt_items: {
        Row: {
          id: string;
          receipt_id: string;
          description: string | null;
          quantity: number;
          unit_price: number | null;
          total_price: number | null;
          category: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          receipt_id: string;
          description?: string | null;
          quantity?: number;
          unit_price?: number | null;
          total_price?: number | null;
          category?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          receipt_id?: string;
          description?: string | null;
          quantity?: number;
          unit_price?: number | null;
          total_price?: number | null;
          category?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_items_receipt_id_fkey';
            columns: ['receipt_id'];
            referencedRelation: 'receipts';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
