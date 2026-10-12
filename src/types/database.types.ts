export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          organization_id: string
          prospect_company: string
          prospect_email: string
          prospect_name: string
          prospect_token_hash: string | null
          request_expires_at: string
          requested_document_ids: string[]
          resolved_at: string | null
          resolved_by: string | null
          state: Database["public"]["Enums"]["access_request_state"]
          ua_summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          organization_id: string
          prospect_company: string
          prospect_email: string
          prospect_name: string
          prospect_token_hash?: string | null
          request_expires_at: string
          requested_document_ids: string[]
          resolved_at?: string | null
          resolved_by?: string | null
          state?: Database["public"]["Enums"]["access_request_state"]
          ua_summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          organization_id?: string
          prospect_company?: string
          prospect_email?: string
          prospect_name?: string
          prospect_token_hash?: string | null
          request_expires_at?: string
          requested_document_ids?: string[]
          resolved_at?: string | null
          resolved_by?: string | null
          state?: Database["public"]["Enums"]["access_request_state"]
          ua_summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_citations: {
        Row: {
          answer_id: string
          created_at: string
          excerpt_sha256: string
          id: string
          organization_id: string
          position: number
          retrieval_score: number
          source_id: string
          source_type: string
        }
        Insert: {
          answer_id: string
          created_at?: string
          excerpt_sha256: string
          id?: string
          organization_id: string
          position: number
          retrieval_score: number
          source_id: string
          source_type: string
        }
        Update: {
          answer_id?: string
          created_at?: string
          excerpt_sha256?: string
          id?: string
          organization_id?: string
          position?: number
          retrieval_score?: number
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_citations_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_citations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_run_items: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          disposition: Database["public"]["Enums"]["ai_disposition"] | null
          error_code: string | null
          id: string
          organization_id: string
          question_id: string
          run_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["answer_run_item_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          disposition?: Database["public"]["Enums"]["ai_disposition"] | null
          error_code?: string | null
          id?: string
          organization_id: string
          question_id: string
          run_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["answer_run_item_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          disposition?: Database["public"]["Enums"]["ai_disposition"] | null
          error_code?: string | null
          id?: string
          organization_id?: string
          question_id?: string
          run_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["answer_run_item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_run_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_run_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "answer_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          error_code: string | null
          estimated_cost_micro_usd: number
          id: string
          idempotency_key: string | null
          input_tokens: number
          model: string
          organization_id: string
          output_tokens: number
          prompt_version: string
          questionnaire_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["answer_run_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          estimated_cost_micro_usd?: number
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          model: string
          organization_id: string
          output_tokens?: number
          prompt_version: string
          questionnaire_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["answer_run_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          estimated_cost_micro_usd?: number
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          model?: string
          organization_id?: string
          output_tokens?: number
          prompt_version?: string
          questionnaire_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["answer_run_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_runs_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_versions: {
        Row: {
          answer_id: string
          author_id: string | null
          created_at: string
          creator_type: Database["public"]["Enums"]["answer_creator_type"]
          id: string
          organization_id: string
          question_id: string
          revision: number
          text: string
          version_number: number
        }
        Insert: {
          answer_id: string
          author_id?: string | null
          created_at?: string
          creator_type: Database["public"]["Enums"]["answer_creator_type"]
          id?: string
          organization_id: string
          question_id: string
          revision: number
          text: string
          version_number: number
        }
        Update: {
          answer_id?: string
          author_id?: string | null
          created_at?: string
          creator_type?: Database["public"]["Enums"]["answer_creator_type"]
          id?: string
          organization_id?: string
          question_id?: string
          revision?: number
          text?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "answer_versions_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_versions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      answers: {
        Row: {
          ai_disposition: Database["public"]["Enums"]["ai_disposition"] | null
          ai_run_id: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          creator_type: Database["public"]["Enums"]["answer_creator_type"]
          current_text: string
          evidence_strength:
            | Database["public"]["Enums"]["evidence_strength"]
            | null
          id: string
          organization_id: string
          question_id: string
          review_note: string | null
          revision: number
          status: Database["public"]["Enums"]["answer_status"]
          updated_at: string
        }
        Insert: {
          ai_disposition?: Database["public"]["Enums"]["ai_disposition"] | null
          ai_run_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          creator_type?: Database["public"]["Enums"]["answer_creator_type"]
          current_text: string
          evidence_strength?:
            | Database["public"]["Enums"]["evidence_strength"]
            | null
          id?: string
          organization_id: string
          question_id: string
          review_note?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["answer_status"]
          updated_at?: string
        }
        Update: {
          ai_disposition?: Database["public"]["Enums"]["ai_disposition"] | null
          ai_run_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          creator_type?: Database["public"]["Enums"]["answer_creator_type"]
          current_text?: string
          evidence_strength?:
            | Database["public"]["Enums"]["evidence_strength"]
            | null
          id?: string
          organization_id?: string
          question_id?: string
          review_note?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["answer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_ai_run_id_fkey"
            columns: ["ai_run_id"]
            isOneToOne: false
            referencedRelation: "answer_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: true
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          created_at: string
          organization_id: string
          provider_customer_id: string
          provider_store_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          provider_customer_id: string
          provider_store_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          provider_customer_id?: string
          provider_store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          attempts: number
          event_hash: string
          event_status: string
          event_type: string
          id: string
          last_error_code: string | null
          organization_id: string | null
          out_of_order: boolean
          processed_at: string | null
          provider_event_id: string
          provider_subscription_id: string
          received_at: string
        }
        Insert: {
          attempts?: number
          event_hash: string
          event_status?: string
          event_type: string
          id?: string
          last_error_code?: string | null
          organization_id?: string | null
          out_of_order?: boolean
          processed_at?: string | null
          provider_event_id: string
          provider_subscription_id: string
          received_at?: string
        }
        Update: {
          attempts?: number
          event_hash?: string
          event_status?: string
          event_type?: string
          id?: string
          last_error_code?: string | null
          organization_id?: string | null
          out_of_order?: boolean
          processed_at?: string | null
          provider_event_id?: string
          provider_subscription_id?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          created_at: string
          demo: boolean
          id: string
          issuer: string | null
          name: string
          organization_id: string
          position: number
          publicly_visible: boolean
          status: Database["public"]["Enums"]["certification_status"]
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          demo?: boolean
          id?: string
          issuer?: string | null
          name: string
          organization_id: string
          position?: number
          publicly_visible?: boolean
          status?: Database["public"]["Enums"]["certification_status"]
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          demo?: boolean
          id?: string
          issuer?: string | null
          name?: string
          organization_id?: string
          position?: number
          publicly_visible?: boolean
          status?: Database["public"]["Enums"]["certification_status"]
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
          parent_id: string | null
          question_id: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
          parent_id?: string | null
          question_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          parent_id?: string | null
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_grants: {
        Row: {
          access_request_id: string
          created_at: string
          document_id: string
          expires_at: string
          granted_by: string | null
          id: string
          organization_id: string
          state: Database["public"]["Enums"]["access_grant_state"]
          updated_at: string
        }
        Insert: {
          access_request_id: string
          created_at?: string
          document_id: string
          expires_at: string
          granted_by?: string | null
          id?: string
          organization_id: string
          state?: Database["public"]["Enums"]["access_grant_state"]
          updated_at?: string
        }
        Update: {
          access_request_id?: string
          created_at?: string
          document_id?: string
          expires_at?: string
          granted_by?: string | null
          id?: string
          organization_id?: string
          state?: Database["public"]["Enums"]["access_grant_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_access_grants_access_request_id_fkey"
            columns: ["access_request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_grants_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          checksum_sha256: string
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          organization_id: string
          search_vector: unknown
          section: string
          sequence: number
          token_count: number
          version_id: string
        }
        Insert: {
          checksum_sha256: string
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          organization_id: string
          search_vector?: unknown
          section?: string
          sequence: number
          token_count: number
          version_id: string
        }
        Update: {
          checksum_sha256?: string
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          organization_id?: string
          search_vector?: unknown
          section?: string
          sequence?: number
          token_count?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          byte_size: number
          char_count: number | null
          checksum_sha256: string
          created_at: string
          document_id: string
          id: string
          mime_type: string
          organization_id: string
          page_count: number | null
          parser_version: string | null
          processing_attempts: number
          processing_error_code: string | null
          processing_state: Database["public"]["Enums"]["document_processing_state"]
          storage_path: string
          updated_at: string
          version_number: number
        }
        Insert: {
          byte_size: number
          char_count?: number | null
          checksum_sha256: string
          created_at?: string
          document_id: string
          id?: string
          mime_type: string
          organization_id: string
          page_count?: number | null
          parser_version?: string | null
          processing_attempts?: number
          processing_error_code?: string | null
          processing_state?: Database["public"]["Enums"]["document_processing_state"]
          storage_path: string
          updated_at?: string
          version_number: number
        }
        Update: {
          byte_size?: number
          char_count?: number | null
          checksum_sha256?: string
          created_at?: string
          document_id?: string
          id?: string
          mime_type?: string
          organization_id?: string
          page_count?: number | null
          parser_version?: string | null
          processing_attempts?: number
          processing_error_code?: string | null
          processing_state?: Database["public"]["Enums"]["document_processing_state"]
          storage_path?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string
          created_at: string
          id: string
          organization_id: string
          owner_id: string | null
          review_by: string | null
          state: Database["public"]["Enums"]["document_state"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          organization_id: string
          owner_id?: string | null
          review_by?: string | null
          state?: Database["public"]["Enums"]["document_state"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string | null
          review_by?: string | null
          state?: Database["public"]["Enums"]["document_state"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      download_events: {
        Row: {
          access_request_id: string
          created_at: string
          document_id: string
          document_version_id: string
          grant_id: string
          id: string
          ip_hash: string | null
          organization_id: string
          ua_summary: string | null
        }
        Insert: {
          access_request_id: string
          created_at?: string
          document_id: string
          document_version_id: string
          grant_id: string
          id?: string
          ip_hash?: string | null
          organization_id: string
          ua_summary?: string | null
        }
        Update: {
          access_request_id?: string
          created_at?: string
          document_id?: string
          document_version_id?: string
          grant_id?: string
          id?: string
          ip_hash?: string | null
          organization_id?: string
          ua_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "download_events_access_request_id_fkey"
            columns: ["access_request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_events_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_events_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "document_access_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          answer: string
          category: string
          created_at: string
          id: string
          organization_id: string
          owner_id: string | null
          question: string
          review_by: string | null
          review_state: Database["public"]["Enums"]["knowledge_entry_review_state"]
          search_vector: unknown
          tags: string[]
          updated_at: string
        }
        Insert: {
          answer: string
          category?: string
          created_at?: string
          id?: string
          organization_id: string
          owner_id?: string | null
          question: string
          review_by?: string | null
          review_state?: Database["public"]["Enums"]["knowledge_entry_review_state"]
          search_vector?: unknown
          tags?: string[]
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string | null
          question?: string
          review_by?: string | null
          review_state?: Database["public"]["Enums"]["knowledge_entry_review_state"]
          search_vector?: unknown
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entry_versions: {
        Row: {
          answer: string
          category: string
          created_at: string
          edited_by: string | null
          entry_id: string
          id: string
          organization_id: string
          question: string
          review_state: Database["public"]["Enums"]["knowledge_entry_review_state"]
          tags: string[]
          version_number: number
        }
        Insert: {
          answer: string
          category: string
          created_at?: string
          edited_by?: string | null
          entry_id: string
          id?: string
          organization_id: string
          question: string
          review_state: Database["public"]["Enums"]["knowledge_entry_review_state"]
          tags: string[]
          version_number: number
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string
          edited_by?: string | null
          entry_id?: string
          id?: string
          organization_id?: string
          question?: string
          review_state?: Database["public"]["Enums"]["knowledge_entry_review_state"]
          tags?: string[]
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entry_versions_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "knowledge_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_entry_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      nda_acceptances: {
        Row: {
          accepted_at: string
          access_request_id: string
          id: string
          ip_hash: string | null
          organization_id: string
          terms_hash: string
          terms_version: string
        }
        Insert: {
          accepted_at?: string
          access_request_id: string
          id?: string
          ip_hash?: string | null
          organization_id: string
          terms_hash: string
          terms_version: string
        }
        Update: {
          accepted_at?: string
          access_request_id?: string
          id?: string
          ip_hash?: string | null
          organization_id?: string
          terms_hash?: string
          terms_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "nda_acceptances_access_request_id_fkey"
            columns: ["access_request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nda_acceptances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          organization_id: string
          questionnaire_id: string | null
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          organization_id: string
          questionnaire_id?: string | null
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
          questionnaire_id?: string | null
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          organization_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_drafts_disabled: boolean
          created_at: string
          deletion_requested_at: string | null
          deletion_requested_by: string | null
          id: string
          logo_url: string | null
          name: string
          retention_days: number
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          ai_drafts_disabled?: boolean
          created_at?: string
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          retention_days?: number
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          ai_drafts_disabled?: boolean
          created_at?: string
          deletion_requested_at?: string | null
          deletion_requested_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          retention_days?: number
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: []
      }
      plan_entitlements: {
        Row: {
          created_at: string
          description: string
          display_name: string
          document_limit: number
          member_limit: number
          monthly_ai_draft_limit: number
          monthly_questionnaire_limit: number
          plan_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          display_name: string
          document_limit: number
          member_limit: number
          monthly_ai_draft_limit: number
          monthly_questionnaire_limit: number
          plan_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          document_limit?: number
          member_limit?: number
          monthly_ai_draft_limit?: number
          monthly_questionnaire_limit?: number
          plan_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      questionnaire_exports: {
        Row: {
          approved_count: number
          blank_count: number
          byte_size: number
          checksum_sha256: string
          created_at: string
          exported_by: string | null
          filename: string
          format: string
          id: string
          mime_type: string
          organization_id: string
          question_count: number
          questionnaire_id: string
          storage_path: string
          written_cell_count: number
        }
        Insert: {
          approved_count: number
          blank_count: number
          byte_size: number
          checksum_sha256: string
          created_at?: string
          exported_by?: string | null
          filename: string
          format: string
          id: string
          mime_type: string
          organization_id: string
          question_count: number
          questionnaire_id: string
          storage_path: string
          written_cell_count: number
        }
        Update: {
          approved_count?: number
          blank_count?: number
          byte_size?: number
          checksum_sha256?: string
          created_at?: string
          exported_by?: string | null
          filename?: string
          format?: string
          id?: string
          mime_type?: string
          organization_id?: string
          question_count?: number
          questionnaire_id?: string
          storage_path?: string
          written_cell_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaire_exports_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_files: {
        Row: {
          byte_size: number
          checksum_sha256: string
          created_at: string
          exported_at: string | null
          exported_checksum_sha256: string | null
          exported_storage_path: string | null
          format: string
          id: string
          metadata: Json
          mime_type: string
          organization_id: string
          parser_version: string | null
          questionnaire_id: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          byte_size: number
          checksum_sha256: string
          created_at?: string
          exported_at?: string | null
          exported_checksum_sha256?: string | null
          exported_storage_path?: string | null
          format: string
          id?: string
          metadata?: Json
          mime_type: string
          organization_id: string
          parser_version?: string | null
          questionnaire_id: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          byte_size?: number
          checksum_sha256?: string
          created_at?: string
          exported_at?: string | null
          exported_checksum_sha256?: string | null
          exported_storage_path?: string | null
          format?: string
          id?: string
          metadata?: Json
          mime_type?: string
          organization_id?: string
          parser_version?: string | null
          questionnaire_id?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaire_files_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: true
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaires: {
        Row: {
          assigned_reviewer: string | null
          created_at: string
          created_by: string | null
          customer: string
          due_date: string | null
          id: string
          organization_id: string
          status: Database["public"]["Enums"]["questionnaire_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_reviewer?: string | null
          created_at?: string
          created_by?: string | null
          customer?: string
          due_date?: string | null
          id?: string
          organization_id: string
          status?: Database["public"]["Enums"]["questionnaire_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_reviewer?: string | null
          created_at?: string
          created_by?: string | null
          customer?: string
          due_date?: string | null
          id?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["questionnaire_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionnaires_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          answer_cell: string | null
          assignee_id: string | null
          blank_by_choice: boolean
          category: string
          created_at: string
          id: string
          notes_cell: string | null
          organization_id: string
          position: number
          question_cell: string
          question_normalized: string
          question_original: string
          questionnaire_id: string
          row_number: number
          search_vector: unknown
          sheet_name: string
          status: Database["public"]["Enums"]["answer_status"]
          updated_at: string
        }
        Insert: {
          answer_cell?: string | null
          assignee_id?: string | null
          blank_by_choice?: boolean
          category?: string
          created_at?: string
          id?: string
          notes_cell?: string | null
          organization_id: string
          position: number
          question_cell: string
          question_normalized: string
          question_original: string
          questionnaire_id: string
          row_number: number
          search_vector?: unknown
          sheet_name: string
          status?: Database["public"]["Enums"]["answer_status"]
          updated_at?: string
        }
        Update: {
          answer_cell?: string | null
          assignee_id?: string | null
          blank_by_choice?: boolean
          category?: string
          created_at?: string
          id?: string
          notes_cell?: string | null
          organization_id?: string
          position?: number
          question_cell?: string
          question_normalized?: string
          question_original?: string
          questionnaire_id?: string
          row_number?: number
          search_vector?: unknown
          sheet_name?: string
          status?: Database["public"]["Enums"]["answer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      subprocessors: {
        Row: {
          company: string
          created_at: string
          data_category: string
          id: string
          organization_id: string
          position: number
          publicly_visible: boolean
          purpose: string
          region: string
          updated_at: string
        }
        Insert: {
          company: string
          created_at?: string
          data_category: string
          id?: string
          organization_id: string
          position?: number
          publicly_visible?: boolean
          purpose: string
          region: string
          updated_at?: string
        }
        Update: {
          company?: string
          created_at?: string
          data_category?: string
          id?: string
          organization_id?: string
          position?: number
          publicly_visible?: boolean
          purpose?: string
          region?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subprocessors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancelled_at: string | null
          created_at: string
          customer_portal_url: string | null
          ends_at: string | null
          id: string
          last_event_at: string | null
          last_event_id: string | null
          organization_id: string
          plan_code: string
          provider_created_at: string | null
          provider_invoice_id: string | null
          provider_order_id: string | null
          provider_product_id: string | null
          provider_subscription_id: string
          provider_updated_at: string | null
          provider_variant_id: string | null
          renews_at: string | null
          status: Database["public"]["Enums"]["billing_subscription_status"]
          test_mode: boolean
          trial_ends_at: string | null
          update_payment_url: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          customer_portal_url?: string | null
          ends_at?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          organization_id: string
          plan_code: string
          provider_created_at?: string | null
          provider_invoice_id?: string | null
          provider_order_id?: string | null
          provider_product_id?: string | null
          provider_subscription_id: string
          provider_updated_at?: string | null
          provider_variant_id?: string | null
          renews_at?: string | null
          status: Database["public"]["Enums"]["billing_subscription_status"]
          test_mode?: boolean
          trial_ends_at?: string | null
          update_payment_url?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          customer_portal_url?: string | null
          ends_at?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          organization_id?: string
          plan_code?: string
          provider_created_at?: string | null
          provider_invoice_id?: string | null
          provider_order_id?: string | null
          provider_product_id?: string | null
          provider_subscription_id?: string
          provider_updated_at?: string | null
          provider_variant_id?: string | null
          renews_at?: string | null
          status?: Database["public"]["Enums"]["billing_subscription_status"]
          test_mode?: boolean
          trial_ends_at?: string | null
          update_payment_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plan_entitlements"
            referencedColumns: ["plan_code"]
          },
        ]
      }
      trust_center_documents: {
        Row: {
          created_at: string
          description: string
          document_id: string
          id: string
          organization_id: string
          position: number
          publicly_requestable: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          document_id: string
          id?: string
          organization_id: string
          position?: number
          publicly_requestable?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          document_id?: string
          id?: string
          organization_id?: string
          position?: number
          publicly_requestable?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_center_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_center_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_center_faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          organization_id: string
          position: number
          question: string
          updated_at: string
          visible: boolean
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          organization_id: string
          position?: number
          question: string
          updated_at?: string
          visible?: boolean
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          organization_id?: string
          position?: number
          question?: string
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "trust_center_faqs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_centers: {
        Row: {
          contact_email: string | null
          created_at: string
          display_name: string | null
          hero_subtitle: string | null
          hero_title: string | null
          logo_url: string | null
          organization_id: string
          overview: string | null
          require_email_verification: boolean
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["trust_center_status"]
          terms_text: string
          terms_version: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          display_name?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          logo_url?: string | null
          organization_id: string
          overview?: string | null
          require_email_verification?: boolean
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["trust_center_status"]
          terms_text?: string
          terms_version?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          display_name?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          logo_url?: string | null
          organization_id?: string
          overview?: string | null
          require_email_verification?: boolean
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["trust_center_status"]
          terms_text?: string
          terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_centers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          created_at: string
          metric: string
          organization_id: string
          period_start: string
          updated_at: string
          used: number
        }
        Insert: {
          created_at?: string
          metric: string
          organization_id: string
          period_start: string
          updated_at?: string
          used?: number
        }
        Update: {
          created_at?: string
          metric?: string
          organization_id?: string
          period_start?: string
          updated_at?: string
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_answer_draft: {
        Args: {
          p_expected_revision: number
          p_organization_id: string
          p_question_id: string
        }
        Returns: number
      }
      accept_organization_invite: {
        Args: { p_raw_token: string }
        Returns: string
      }
      bulk_set_answer_status: {
        Args: {
          p_organization_id: string
          p_question_ids: string[]
          p_status: Database["public"]["Enums"]["answer_status"]
        }
        Returns: number
      }
      cancel_answer_run: {
        Args: { p_organization_id: string; p_run_id: string }
        Returns: undefined
      }
      cancel_organization_deletion: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      claim_answer_run_items: {
        Args: {
          p_batch_size: number
          p_organization_id: string
          p_run_id: string
        }
        Returns: {
          category: string
          item_id: string
          question_id: string
          question_normalized: string
          question_original: string
        }[]
      }
      complete_answer_run_item: {
        Args: {
          p_answer_text: string
          p_citations: Json
          p_disposition: Database["public"]["Enums"]["ai_disposition"]
          p_error_code: string
          p_estimated_cost_micro_usd: number
          p_input_tokens: number
          p_item_id: string
          p_organization_id: string
          p_output_tokens: number
          p_review_note: string
          p_run_id: string
          p_strength: Database["public"]["Enums"]["evidence_strength"]
        }
        Returns: undefined
      }
      confirm_questionnaire_mapping: {
        Args: {
          p_organization_id: string
          p_parser_version: string
          p_questionnaire_id: string
          p_questions: Json
        }
        Returns: number
      }
      confirm_trust_access_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      consume_usage: {
        Args: { p_amount?: number; p_metric: string; p_organization_id: string }
        Returns: {
          allowed: boolean
          limit_value: number
          metric: string
          period_start: string
          plan_code: string
          used: number
        }[]
      }
      create_document_upload: {
        Args: {
          p_byte_size: number
          p_category: string
          p_checksum_sha256: string
          p_document_id?: string
          p_filename: string
          p_mime_type: string
          p_organization_id: string
          p_review_by: string
          p_tags: string[]
          p_title: string
        }
        Returns: {
          document_id: string
          storage_path: string
          version_id: string
        }[]
      }
      create_organization_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      create_questionnaire_upload: {
        Args: {
          p_byte_size: number
          p_checksum_sha256: string
          p_customer: string
          p_due_date: string
          p_filename: string
          p_metadata?: Json
          p_mime_type: string
          p_organization_id: string
          p_title: string
        }
        Returns: {
          file_id: string
          questionnaire_id: string
          storage_path: string
        }[]
      }
      delete_organization: {
        Args: { p_confirmation_slug: string; p_organization_id: string }
        Returns: boolean
      }
      get_billing_snapshot: {
        Args: { p_organization_id: string }
        Returns: {
          ai_drafts_limit: number
          ai_drafts_used: number
          customer_portal_url: string
          deletion_requested_at: string
          documents_limit: number
          documents_used: number
          ends_at: string
          members_limit: number
          members_used: number
          period_start: string
          plan_code: string
          plan_description: string
          plan_name: string
          questionnaires_limit: number
          questionnaires_used: number
          renews_at: string
          retention_days: number
          subscription_status: Database["public"]["Enums"]["billing_subscription_status"]
          trial_ends_at: string
          update_payment_url: string
        }[]
      }
      get_trust_center_overview: { Args: { p_slug: string }; Returns: Json }
      mark_questionnaire_mapping: {
        Args: { p_organization_id: string; p_questionnaire_id: string }
        Returns: undefined
      }
      match_org_evidence: {
        Args: {
          p_match_count?: number
          p_organization_id: string
          p_query_embedding: string
          p_query_text: string
        }
        Returns: {
          category: string
          combined_score: number
          content: string
          document_id: string
          document_title: string
          is_approved_answer: boolean
          review_by: string
          section: string
          source_id: string
          source_type: string
          tags: string[]
          text_rank: number
          vector_similarity: number
        }[]
      }
      preview_organization_invite: {
        Args: { p_raw_token: string }
        Returns: {
          expires_at: string
          invited_role: Database["public"]["Enums"]["app_role"]
          inviter_name: string
          organization_name: string
        }[]
      }
      process_billing_webhook: {
        Args: {
          p_customer_id: string
          p_customer_portal_url: string
          p_ends_at: string
          p_event_hash: string
          p_event_occurred_at: string
          p_event_type: string
          p_order_id: string
          p_organization_id: string
          p_plan_code: string
          p_product_id: string
          p_provider_event_id: string
          p_provider_invoice_id: string
          p_provider_subscription_id: string
          p_renews_at: string
          p_status: Database["public"]["Enums"]["billing_subscription_status"]
          p_store_id: string
          p_test_mode: boolean
          p_trial_ends_at: string
          p_update_payment_url: string
          p_variant_id: string
        }
        Returns: {
          accepted: boolean
          duplicate: boolean
          organization_id: string
          out_of_order: boolean
        }[]
      }
      purge_organization_retention: {
        Args: { p_organization_id: string }
        Returns: number
      }
      record_questionnaire_export: {
        Args: {
          p_approved_count: number
          p_blank_count: number
          p_byte_size: number
          p_checksum_sha256: string
          p_export_id: string
          p_filename: string
          p_format: string
          p_mime_type: string
          p_organization_id: string
          p_question_count: number
          p_questionnaire_id: string
          p_storage_path: string
          p_written_cell_count: number
        }
        Returns: string
      }
      request_organization_deletion: {
        Args: { p_confirmation_slug: string; p_organization_id: string }
        Returns: string
      }
      reset_document_version_for_retry: {
        Args: {
          p_document_id: string
          p_organization_id: string
          p_version_id: string
        }
        Returns: undefined
      }
      retry_answer_run_item: {
        Args: { p_item_id: string; p_organization_id: string; p_run_id: string }
        Returns: undefined
      }
      review_trust_access_request: {
        Args: {
          p_decision: string
          p_document_ids: string[]
          p_grant_days: number
          p_request_id: string
        }
        Returns: string
      }
      revoke_access_grant: { Args: { p_grant_id: string }; Returns: undefined }
      revoke_organization_invite: {
        Args: { p_invite_id: string; p_organization_id: string }
        Returns: undefined
      }
      save_answer: {
        Args: {
          p_expected_revision: number
          p_organization_id: string
          p_question_id: string
          p_text: string
        }
        Returns: number
      }
      save_knowledge_entry: {
        Args: {
          p_answer: string
          p_category: string
          p_entry_id?: string
          p_organization_id: string
          p_question: string
          p_review_by: string
          p_review_state: Database["public"]["Enums"]["knowledge_entry_review_state"]
          p_tags: string[]
        }
        Returns: string
      }
      set_answer_status: {
        Args: {
          p_expected_revision: number
          p_organization_id: string
          p_question_id: string
          p_status: Database["public"]["Enums"]["answer_status"]
        }
        Returns: number
      }
      set_question_assignee: {
        Args: {
          p_assignee_id: string
          p_organization_id: string
          p_question_ids: string[]
        }
        Returns: number
      }
      set_question_blank_by_choice: {
        Args: {
          p_organization_id: string
          p_question_ids: string[]
          p_value: boolean
        }
        Returns: number
      }
      set_questionnaire_reviewer: {
        Args: {
          p_organization_id: string
          p_questionnaire_id: string
          p_reviewer_id: string
        }
        Returns: undefined
      }
      set_questionnaire_status: {
        Args: {
          p_organization_id: string
          p_questionnaire_id: string
          p_status: Database["public"]["Enums"]["questionnaire_status"]
        }
        Returns: Database["public"]["Enums"]["questionnaire_status"]
      }
      set_trust_center_slug: {
        Args: { p_organization_id: string; p_slug: string }
        Returns: undefined
      }
      set_trust_center_status: {
        Args: {
          p_organization_id: string
          p_status: Database["public"]["Enums"]["trust_center_status"]
        }
        Returns: undefined
      }
      start_answer_run: {
        Args: {
          p_idempotency_key?: string
          p_model: string
          p_organization_id: string
          p_prompt_version: string
          p_question_ids?: string[]
          p_questionnaire_id: string
        }
        Returns: {
          created: boolean
          requested_count: number
          run_id: string
          skipped_count: number
        }[]
      }
      storage_document_manager_access: {
        Args: { p_path: string }
        Returns: boolean
      }
      storage_document_member_access: {
        Args: { p_path: string }
        Returns: boolean
      }
      storage_document_path_valid: {
        Args: { p_path: string }
        Returns: boolean
      }
      storage_questionnaire_importer_access: {
        Args: { p_path: string }
        Returns: boolean
      }
      storage_questionnaire_manager_access: {
        Args: { p_path: string }
        Returns: boolean
      }
      storage_questionnaire_member_access: {
        Args: { p_path: string }
        Returns: boolean
      }
      storage_questionnaire_path_valid: {
        Args: { p_path: string }
        Returns: boolean
      }
      submit_trust_access_request: {
        Args: {
          p_accept_terms: boolean
          p_company: string
          p_document_ids: string[]
          p_email: string
          p_ip_hash: string
          p_name: string
          p_slug: string
          p_ua_summary: string
        }
        Returns: string
      }
      submit_trust_access_request_result: {
        Args: {
          p_accept_terms: boolean
          p_company: string
          p_document_ids: string[]
          p_email: string
          p_ip_hash: string
          p_name: string
          p_slug: string
          p_ua_summary: string
        }
        Returns: Json
      }
      trust_accept_terms: {
        Args: { p_raw_token: string; p_slug: string }
        Returns: string
      }
      trust_download_document: {
        Args: {
          p_document_id: string
          p_ip_hash: string
          p_raw_token: string
          p_slug: string
          p_ua_summary: string
        }
        Returns: Json
      }
      trust_prospect_documents: {
        Args: { p_raw_token: string; p_slug: string }
        Returns: Json
      }
      update_question_category: {
        Args: {
          p_category: string
          p_organization_id: string
          p_question_id: string
        }
        Returns: undefined
      }
      update_workspace_settings: {
        Args: {
          p_ai_drafts_disabled: boolean
          p_organization_id: string
          p_retention_days: number
        }
        Returns: {
          ai_drafts_disabled: boolean
          retention_days: number
        }[]
      }
      zz_probe: {
        Args: { p_key: string; p_questionnaire_id: string }
        Returns: {
          arg: string
          key_sample: string
          total: number
          with_key: number
        }[]
      }
    }
    Enums: {
      access_grant_state: "active" | "expired" | "revoked"
      access_request_state:
        | "submitted"
        | "pending_review"
        | "approved"
        | "denied"
        | "expired"
      ai_disposition: "answered" | "needs_review" | "insufficient_evidence"
      answer_creator_type: "manual" | "ai"
      answer_run_item_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "skipped"
      answer_run_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
      answer_status:
        | "empty"
        | "generating"
        | "drafted"
        | "answered"
        | "insufficient_evidence"
        | "in_review"
        | "changes_requested"
        | "rejected"
        | "approved"
      app_role: "owner" | "admin" | "reviewer" | "viewer"
      billing_subscription_status:
        | "none"
        | "trialing"
        | "active"
        | "past_due"
        | "paused"
        | "cancelled"
        | "expired"
      certification_status: "active" | "expired" | "planned"
      document_processing_state:
        | "pending"
        | "parsing"
        | "embedding"
        | "ready"
        | "failed"
      document_state: "active" | "archived"
      evidence_strength: "high" | "medium" | "low" | "insufficient"
      knowledge_entry_review_state:
        | "draft"
        | "approved"
        | "needs_review"
        | "retired"
      organization_status: "active" | "deactivated"
      questionnaire_status:
        | "importing"
        | "mapping"
        | "active"
        | "in_review"
        | "completed"
        | "exported"
        | "archived"
      trust_center_status: "draft" | "preview" | "published"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_grant_state: ["active", "expired", "revoked"],
      access_request_state: [
        "submitted",
        "pending_review",
        "approved",
        "denied",
        "expired",
      ],
      ai_disposition: ["answered", "needs_review", "insufficient_evidence"],
      answer_creator_type: ["manual", "ai"],
      answer_run_item_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "skipped",
      ],
      answer_run_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
      ],
      answer_status: [
        "empty",
        "generating",
        "drafted",
        "answered",
        "insufficient_evidence",
        "in_review",
        "changes_requested",
        "rejected",
        "approved",
      ],
      app_role: ["owner", "admin", "reviewer", "viewer"],
      billing_subscription_status: [
        "none",
        "trialing",
        "active",
        "past_due",
        "paused",
        "cancelled",
        "expired",
      ],
      certification_status: ["active", "expired", "planned"],
      document_processing_state: [
        "pending",
        "parsing",
        "embedding",
        "ready",
        "failed",
      ],
      document_state: ["active", "archived"],
      evidence_strength: ["high", "medium", "low", "insufficient"],
      knowledge_entry_review_state: [
        "draft",
        "approved",
        "needs_review",
        "retired",
      ],
      organization_status: ["active", "deactivated"],
      questionnaire_status: [
        "importing",
        "mapping",
        "active",
        "in_review",
        "completed",
        "exported",
        "archived",
      ],
      trust_center_status: ["draft", "preview", "published"],
    },
  },
} as const
