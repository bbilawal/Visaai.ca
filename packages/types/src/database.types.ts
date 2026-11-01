export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_lockouts: {
        Row: {
          email: string
          failed_count: number
          ip: string
          last_failed_at: string | null
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          email: string
          failed_count?: number
          ip?: string
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          failed_count?: number
          ip?: string
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      action_items: {
        Row: {
          completed_at: string | null
          due_at: string | null
          id: string
          post_submission_event_id: string
          status: string
          task_type: string
        }
        Insert: {
          completed_at?: string | null
          due_at?: string | null
          id?: string
          post_submission_event_id: string
          status?: string
          task_type: string
        }
        Update: {
          completed_at?: string | null
          due_at?: string | null
          id?: string
          post_submission_event_id?: string
          status?: string
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_post_submission_event_id_fkey"
            columns: ["post_submission_event_id"]
            isOneToOne: false
            referencedRelation: "post_submission_events"
            referencedColumns: ["id"]
          },
        ]
      }
      addon_purchases: {
        Row: {
          addon_sku: string
          amount_cents: number
          application_id: string
          created_at: string
          id: string
          payment_id: string | null
          status: string
          stripe_payment_intent_id: string | null
          user_id: string
        }
        Insert: {
          addon_sku: string
          amount_cents: number
          application_id: string
          created_at?: string
          id?: string
          payment_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          user_id: string
        }
        Update: {
          addon_sku?: string
          amount_cents?: number
          application_id?: string
          created_at?: string
          id?: string
          payment_id?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addon_purchases_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "addon_purchases_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "addon_purchases_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_purchases_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "addon_purchases_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addon_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          application_id: string | null
          billable_cost_usd: number | null
          cache_write_tokens: number
          cached_input_tokens: number
          created_at: string
          id: string
          input_tokens: number
          model: string
          operation: string
          output_tokens: number
          price_snapshot_id: string | null
          provider: string
          request_cost_usd: number
          units: number
          user_id: string | null
        }
        Insert: {
          application_id?: string | null
          billable_cost_usd?: number | null
          cache_write_tokens?: number
          cached_input_tokens?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model: string
          operation: string
          output_tokens?: number
          price_snapshot_id?: string | null
          provider: string
          request_cost_usd: number
          units?: number
          user_id?: string | null
        }
        Update: {
          application_id?: string | null
          billable_cost_usd?: number | null
          cache_write_tokens?: number
          cached_input_tokens?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          operation?: string
          output_tokens?: number
          price_snapshot_id?: string | null
          provider?: string
          request_cost_usd?: number
          units?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      analytics_alert_event: {
        Row: {
          fired_at: string
          id: string
          kind: string
          message: string
          rule_id: string
          value: number | null
        }
        Insert: {
          fired_at?: string
          id?: string
          kind: string
          message: string
          rule_id: string
          value?: number | null
        }
        Update: {
          fired_at?: string
          id?: string
          kind?: string
          message?: string
          rule_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_alert_event_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "analytics_alert_rule"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_alert_rule: {
        Row: {
          combine: string
          conditions: Json
          created_at: string
          created_by: string
          enabled: boolean
          id: string
          last_evaluated_at: string | null
          last_transition_at: string | null
          last_value: number | null
          metric: string
          metric_key: string
          name: string
          notify_user_ids: string[]
          query: Json
          recipients: string[]
          state: string
          updated_at: string
        }
        Insert: {
          combine?: string
          conditions: Json
          created_at?: string
          created_by: string
          enabled?: boolean
          id?: string
          last_evaluated_at?: string | null
          last_transition_at?: string | null
          last_value?: number | null
          metric: string
          metric_key: string
          name: string
          notify_user_ids?: string[]
          query: Json
          recipients?: string[]
          state?: string
          updated_at?: string
        }
        Update: {
          combine?: string
          conditions?: Json
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          last_evaluated_at?: string | null
          last_transition_at?: string | null
          last_value?: number | null
          metric?: string
          metric_key?: string
          name?: string
          notify_user_ids?: string[]
          query?: Json
          recipients?: string[]
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      analytics_daily_active: {
        Row: {
          dau: number
          day: string
          mau: number
          wau: number
        }
        Insert: {
          dau?: number
          day: string
          mau?: number
          wau?: number
        }
        Update: {
          dau?: number
          day?: string
          mau?: number
          wau?: number
        }
        Relationships: []
      }
      analytics_event_daily: {
        Row: {
          count: number
          day: string
          name: string
        }
        Insert: {
          count?: number
          day: string
          name: string
        }
        Update: {
          count?: number
          day?: string
          name?: string
        }
        Relationships: []
      }
      analytics_event_stream: {
        Row: {
          anonymous_id: string | null
          application_id: string | null
          event_id: string
          name: string
          occurred_at: string
          props: Json
          received_at: string
          schema_version: number
          session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          application_id?: string | null
          event_id: string
          name: string
          occurred_at: string
          props?: Json
          received_at?: string
          schema_version?: number
          session_id?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          application_id?: string | null
          event_id?: string
          name?: string
          occurred_at?: string
          props?: Json
          received_at?: string
          schema_version?: number
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_event_stream_202608: {
        Row: {
          anonymous_id: string | null
          application_id: string | null
          event_id: string
          name: string
          occurred_at: string
          props: Json
          received_at: string
          schema_version: number
          session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          application_id?: string | null
          event_id: string
          name: string
          occurred_at: string
          props?: Json
          received_at?: string
          schema_version?: number
          session_id?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          application_id?: string | null
          event_id?: string
          name?: string
          occurred_at?: string
          props?: Json
          received_at?: string
          schema_version?: number
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_event_stream_202609: {
        Row: {
          anonymous_id: string | null
          application_id: string | null
          event_id: string
          name: string
          occurred_at: string
          props: Json
          received_at: string
          schema_version: number
          session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          anonymous_id?: string | null
          application_id?: string | null
          event_id: string
          name: string
          occurred_at: string
          props?: Json
          received_at?: string
          schema_version?: number
          session_id?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          anonymous_id?: string | null
          application_id?: string | null
          event_id?: string
          name?: string
          occurred_at?: string
          props?: Json
          received_at?: string
          schema_version?: number
          session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          anon_id: string | null
          application_id: string | null
          event_name: string
          id: string
          occurred_at: string
          properties: Json
          stage: string | null
          user_id: string | null
        }
        Insert: {
          anon_id?: string | null
          application_id?: string | null
          event_name: string
          id?: string
          occurred_at?: string
          properties?: Json
          stage?: string | null
          user_id?: string | null
        }
        Update: {
          anon_id?: string | null
          application_id?: string | null
          event_name?: string
          id?: string
          occurred_at?: string
          properties?: Json
          stage?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "analytics_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "analytics_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "analytics_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_identity_map: {
        Row: {
          anonymous_id: string
          linked_at: string
          user_id: string
        }
        Insert: {
          anonymous_id: string
          linked_at?: string
          user_id: string
        }
        Update: {
          anonymous_id?: string
          linked_at?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_report_run: {
        Row: {
          delivery_error: string | null
          error: string | null
          id: string
          ran_at: string
          result_snapshot: Json | null
          saved_report_id: string
          scheduled_report_id: string | null
          status: string
        }
        Insert: {
          delivery_error?: string | null
          error?: string | null
          id?: string
          ran_at?: string
          result_snapshot?: Json | null
          saved_report_id: string
          scheduled_report_id?: string | null
          status: string
        }
        Update: {
          delivery_error?: string | null
          error?: string | null
          id?: string
          ran_at?: string
          result_snapshot?: Json | null
          saved_report_id?: string
          scheduled_report_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_report_run_saved_report_id_fkey"
            columns: ["saved_report_id"]
            isOneToOne: false
            referencedRelation: "analytics_saved_report"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_saved_report: {
        Row: {
          created_at: string
          created_by: string
          id: string
          metric: string
          metric_key: string
          name: string
          query: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          metric: string
          metric_key: string
          name: string
          query: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          metric?: string
          metric_key?: string
          name?: string
          query?: Json
          updated_at?: string
        }
        Relationships: []
      }
      analytics_scheduled_report: {
        Row: {
          cron: string
          enabled: boolean
          format: string
          id: string
          last_run_at: string | null
          next_run_at: string | null
          notify_user_ids: string[]
          recipients: string[]
          saved_report_id: string
        }
        Insert: {
          cron: string
          enabled?: boolean
          format: string
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          notify_user_ids?: string[]
          recipients: string[]
          saved_report_id: string
        }
        Update: {
          cron?: string
          enabled?: boolean
          format?: string
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          notify_user_ids?: string[]
          recipients?: string[]
          saved_report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_scheduled_report_saved_report_id_fkey"
            columns: ["saved_report_id"]
            isOneToOne: false
            referencedRelation: "analytics_saved_report"
            referencedColumns: ["id"]
          },
        ]
      }
      application_outcomes: {
        Row: {
          application_id: string
          decided_at: string | null
          id: string
          outcome: string
          refusal_reasons: string[] | null
          reported_at: string
          user_id: string
        }
        Insert: {
          application_id: string
          decided_at?: string | null
          id?: string
          outcome: string
          refusal_reasons?: string[] | null
          reported_at?: string
          user_id: string
        }
        Update: {
          application_id?: string
          decided_at?: string | null
          id?: string
          outcome?: string
          refusal_reasons?: string[] | null
          reported_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_outcomes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_outcomes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_outcomes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_outcomes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_outcomes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      application_profiles: {
        Row: {
          application_id: string
          id: string
          last_updated_at: string
          profile_json: Json
          risk_indicators_json: Json
        }
        Insert: {
          application_id: string
          id?: string
          last_updated_at?: string
          profile_json?: Json
          risk_indicators_json?: Json
        }
        Update: {
          application_id?: string
          id?: string
          last_updated_at?: string
          profile_json?: Json
          risk_indicators_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "application_profiles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_profiles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_profiles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_profiles_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      applications: {
        Row: {
          created_at: string
          decision_at: string | null
          destination_country: string | null
          destination_state: string | null
          escalation_reason: string | null
          framework_id: string | null
          id: string
          monitor_token: string | null
          needs_consultant_escalation: boolean
          plan_tier: string
          status: string
          submitted_at: string | null
          user_id: string
          visa_type_id: string | null
          vri_score: number | null
        }
        Insert: {
          created_at?: string
          decision_at?: string | null
          destination_country?: string | null
          destination_state?: string | null
          escalation_reason?: string | null
          framework_id?: string | null
          id?: string
          monitor_token?: string | null
          needs_consultant_escalation?: boolean
          plan_tier?: string
          status?: string
          submitted_at?: string | null
          user_id: string
          visa_type_id?: string | null
          vri_score?: number | null
        }
        Update: {
          created_at?: string
          decision_at?: string | null
          destination_country?: string | null
          destination_state?: string | null
          escalation_reason?: string | null
          framework_id?: string | null
          id?: string
          monitor_token?: string | null
          needs_consultant_escalation?: boolean
          plan_tier?: string
          status?: string
          submitted_at?: string | null
          user_id?: string
          visa_type_id?: string | null
          vri_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_framework_id_fkey"
            columns: ["framework_id"]
            isOneToOne: false
            referencedRelation: "country_frameworks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_publishable_pages"
            referencedColumns: ["visa_type_id"]
          },
          {
            foreignKeyName: "applications_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_types"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_chain_state: {
        Row: {
          application_id: string
          last_row_hash: string
          last_seq: number
        }
        Insert: {
          application_id: string
          last_row_hash: string
          last_seq?: number
        }
        Update: {
          application_id?: string
          last_row_hash?: string
          last_seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_chain_state_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "audit_chain_state_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "audit_chain_state_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_chain_state_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["audit_actor_role"]
          application_id: string | null
          canon_version: number
          document_id: string | null
          event_type: Database["public"]["Enums"]["audit_event_type"]
          extension_version: string | null
          field_key: string | null
          from_state: string | null
          hash_algo: string
          id: string
          occurred_at: string
          ocr_run_id: string | null
          payload: Json
          payload_hash: string
          prev_hash: string
          row_hash: string
          schema_version: string | null
          seq: number
          submission_session_id: string | null
          to_state: string | null
          value_hash: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role: Database["public"]["Enums"]["audit_actor_role"]
          application_id?: string | null
          canon_version?: number
          document_id?: string | null
          event_type: Database["public"]["Enums"]["audit_event_type"]
          extension_version?: string | null
          field_key?: string | null
          from_state?: string | null
          hash_algo?: string
          id?: string
          occurred_at?: string
          ocr_run_id?: string | null
          payload?: Json
          payload_hash: string
          prev_hash: string
          row_hash: string
          schema_version?: string | null
          seq: number
          submission_session_id?: string | null
          to_state?: string | null
          value_hash?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["audit_actor_role"]
          application_id?: string | null
          canon_version?: number
          document_id?: string | null
          event_type?: Database["public"]["Enums"]["audit_event_type"]
          extension_version?: string | null
          field_key?: string | null
          from_state?: string | null
          hash_algo?: string
          id?: string
          occurred_at?: string
          ocr_run_id?: string | null
          payload?: Json
          payload_hash?: string
          prev_hash?: string
          row_hash?: string
          schema_version?: string | null
          seq?: number
          submission_session_id?: string | null
          to_state?: string | null
          value_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "audit_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "audit_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "audit_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_ocr_run_id_fkey"
            columns: ["ocr_run_id"]
            isOneToOne: false
            referencedRelation: "ocr_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_submission_session_id_fkey"
            columns: ["submission_session_id"]
            isOneToOne: false
            referencedRelation: "submission_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_audit_log: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auth_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auth_audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_cohort_members: {
        Row: {
          accepted_at: string | null
          cohort_id: string
          created_at: string
          exit_reason: string | null
          exited_at: string | null
          id: string
          invited_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          cohort_id: string
          created_at?: string
          exit_reason?: string | null
          exited_at?: string | null
          id?: string
          invited_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          cohort_id?: string
          created_at?: string
          exit_reason?: string | null
          exited_at?: string | null
          id?: string
          invited_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_cohort_members_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "beta_cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_cohort_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_cohorts: {
        Row: {
          created_at: string
          description: string
          id: string
          max_members: number
          name: string
          platforms: string[]
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          max_members?: number
          name: string
          platforms?: string[]
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          max_members?: number
          name?: string
          platforms?: string[]
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      beta_feedback: {
        Row: {
          app_version: string
          application_id: string | null
          context: Json
          created_at: string
          device: Json
          diagnostics_consent: boolean
          id: string
          kind: string
          message: string
          owner_id: string | null
          rating: number | null
          resolution: string | null
          resolved_at: string | null
          screenshot_path: string | null
          severity: string | null
          status: string
          surface: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string
          application_id?: string | null
          context?: Json
          created_at?: string
          device?: Json
          diagnostics_consent?: boolean
          id?: string
          kind: string
          message?: string
          owner_id?: string | null
          rating?: number | null
          resolution?: string | null
          resolved_at?: string | null
          screenshot_path?: string | null
          severity?: string | null
          status?: string
          surface: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string
          application_id?: string | null
          context?: Json
          created_at?: string
          device?: Json
          diagnostics_consent?: boolean
          id?: string
          kind?: string
          message?: string
          owner_id?: string | null
          rating?: number | null
          resolution?: string | null
          resolved_at?: string | null
          screenshot_path?: string | null
          severity?: string | null
          status?: string
          surface?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beta_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "beta_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "beta_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_feedback_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "beta_feedback_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beta_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          added_reason: string | null
          application_id: string
          document_type: string
          id: string
          label: string
          meta: Json
          required: boolean
          status: string
        }
        Insert: {
          added_reason?: string | null
          application_id: string
          document_type: string
          id?: string
          label: string
          meta?: Json
          required?: boolean
          status?: string
        }
        Update: {
          added_reason?: string | null
          application_id?: string
          document_type?: string
          id?: string
          label?: string
          meta?: Json
          required?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "checklist_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "checklist_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      consultant_approvals: {
        Row: {
          application_id: string
          consultant_id: string
          decided_at: string
          decision: Database["public"]["Enums"]["consultant_decision"]
          field_key: string | null
          id: string
          reason: string | null
          scope: string
          section: string | null
          value_hash: string | null
        }
        Insert: {
          application_id: string
          consultant_id: string
          decided_at?: string
          decision: Database["public"]["Enums"]["consultant_decision"]
          field_key?: string | null
          id?: string
          reason?: string | null
          scope: string
          section?: string | null
          value_hash?: string | null
        }
        Update: {
          application_id?: string
          consultant_id?: string
          decided_at?: string
          decision?: Database["public"]["Enums"]["consultant_decision"]
          field_key?: string | null
          id?: string
          reason?: string | null
          scope?: string
          section?: string | null
          value_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_approvals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_approvals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_approvals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_approvals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_approvals_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_assignments: {
        Row: {
          application_id: string
          assigned_at: string
          assigned_by: string | null
          assigned_by_role: string | null
          completed_at: string | null
          consultant_id: string
          due_at: string
          id: string
          released_at: string | null
          role: string
          status: string
        }
        Insert: {
          application_id: string
          assigned_at?: string
          assigned_by?: string | null
          assigned_by_role?: string | null
          completed_at?: string | null
          consultant_id: string
          due_at?: string
          id?: string
          released_at?: string | null
          role?: string
          status?: string
        }
        Update: {
          application_id?: string
          assigned_at?: string
          assigned_by?: string | null
          assigned_by_role?: string | null
          completed_at?: string | null
          consultant_id?: string
          due_at?: string
          id?: string
          released_at?: string | null
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_availability: {
        Row: {
          accepting_new: boolean
          consultant_id: string
          id: string
          max_cases: number
          timezone: string
          updated_at: string
          working_hours: Json
        }
        Insert: {
          accepting_new?: boolean
          consultant_id: string
          id?: string
          max_cases?: number
          timezone?: string
          updated_at?: string
          working_hours?: Json
        }
        Update: {
          accepting_new?: boolean
          consultant_id?: string
          id?: string
          max_cases?: number
          timezone?: string
          updated_at?: string
          working_hours?: Json
        }
        Relationships: [
          {
            foreignKeyName: "consultant_availability_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_commission_rules: {
        Row: {
          active: boolean
          consultant_id: string | null
          country_code: string | null
          created_at: string
          effective_from: string
          id: string
          model: string
          note: string | null
          platform_fixed_usd: number | null
          platform_pct: number | null
          scope: string
          visa_type: string | null
        }
        Insert: {
          active?: boolean
          consultant_id?: string | null
          country_code?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          model: string
          note?: string | null
          platform_fixed_usd?: number | null
          platform_pct?: number | null
          scope: string
          visa_type?: string | null
        }
        Update: {
          active?: boolean
          consultant_id?: string | null
          country_code?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          model?: string
          note?: string | null
          platform_fixed_usd?: number | null
          platform_pct?: number | null
          scope?: string
          visa_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_commission_rules_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_countries: {
        Row: {
          active: boolean
          consultant_id: string
          country_code: string
          created_at: string
          id: string
        }
        Insert: {
          active?: boolean
          consultant_id: string
          country_code: string
          created_at?: string
          id?: string
        }
        Update: {
          active?: boolean
          consultant_id?: string
          country_code?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_countries_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_notes: {
        Row: {
          application_id: string
          author_id: string
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
        }
        Insert: {
          application_id: string
          author_id: string
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
        }
        Update: {
          application_id?: string
          author_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_payout_items: {
        Row: {
          amount_usd: number
          id: string
          payout_id: string
          service_order_id: string
          stripe_transfer_id: string | null
        }
        Insert: {
          amount_usd: number
          id?: string
          payout_id: string
          service_order_id: string
          stripe_transfer_id?: string | null
        }
        Update: {
          amount_usd?: number
          id?: string
          payout_id?: string
          service_order_id?: string
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_payout_items_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "consultant_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_payout_items_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: true
            referencedRelation: "consultant_service_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_payouts: {
        Row: {
          amount_usd: number
          consultant_id: string
          created_at: string
          currency: string
          id: string
          note: string | null
          payout_date: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_transfer_id: string | null
        }
        Insert: {
          amount_usd: number
          consultant_id: string
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          payout_date?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_transfer_id?: string | null
        }
        Update: {
          amount_usd?: number
          consultant_id?: string
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          payout_date?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_payouts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_profiles: {
        Row: {
          active_status: string
          bio: string | null
          created_at: string
          headline: string | null
          hourly_rate_usd: number | null
          id: string
          kyc_status: string
          license_authority: string | null
          license_country: string | null
          license_number: string | null
          license_verified: boolean
          max_active_cases: number
          payouts_enabled: boolean
          rating_avg: number
          rating_count: number
          specialization: string[]
          stripe_connect_account_id: string | null
          updated_at: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          active_status?: string
          bio?: string | null
          created_at?: string
          headline?: string | null
          hourly_rate_usd?: number | null
          id?: string
          kyc_status?: string
          license_authority?: string | null
          license_country?: string | null
          license_number?: string | null
          license_verified?: boolean
          max_active_cases?: number
          payouts_enabled?: boolean
          rating_avg?: number
          rating_count?: number
          specialization?: string[]
          stripe_connect_account_id?: string | null
          updated_at?: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          active_status?: string
          bio?: string | null
          created_at?: string
          headline?: string | null
          hourly_rate_usd?: number | null
          id?: string
          kyc_status?: string
          license_authority?: string | null
          license_country?: string | null
          license_number?: string | null
          license_verified?: boolean
          max_active_cases?: number
          payouts_enabled?: boolean
          rating_avg?: number
          rating_count?: number
          specialization?: string[]
          stripe_connect_account_id?: string | null
          updated_at?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_reviews: {
        Row: {
          application_id: string | null
          consultant_id: string
          created_at: string
          feedback: string | null
          id: string
          rating: number
          user_id: string
        }
        Insert: {
          application_id?: string | null
          consultant_id: string
          created_at?: string
          feedback?: string | null
          id?: string
          rating: number
          user_id: string
        }
        Update: {
          application_id?: string | null
          consultant_id?: string
          created_at?: string
          feedback?: string | null
          id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_reviews_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_service_orders: {
        Row: {
          amount_usd: number
          application_id: string | null
          commission_rule_id: string | null
          consultant_id: string
          consultant_payout_usd: number
          created_at: string
          credit_covered: boolean
          currency: string
          id: string
          paid_at: string | null
          platform_fee_usd: number
          service_type: string
          status: string
          stripe_payment_intent_id: string | null
          user_id: string
        }
        Insert: {
          amount_usd: number
          application_id?: string | null
          commission_rule_id?: string | null
          consultant_id: string
          consultant_payout_usd?: number
          created_at?: string
          credit_covered?: boolean
          currency?: string
          id?: string
          paid_at?: string | null
          platform_fee_usd?: number
          service_type: string
          status?: string
          stripe_payment_intent_id?: string | null
          user_id: string
        }
        Update: {
          amount_usd?: number
          application_id?: string | null
          commission_rule_id?: string | null
          consultant_id?: string
          consultant_payout_usd?: number
          created_at?: string
          credit_covered?: boolean
          currency?: string
          id?: string
          paid_at?: string | null
          platform_fee_usd?: number
          service_type?: string
          status?: string
          stripe_payment_intent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_service_orders_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_service_orders_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_service_orders_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_service_orders_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultant_service_orders_commission_rule_id_fkey"
            columns: ["commission_rule_id"]
            isOneToOne: false
            referencedRelation: "consultant_commission_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_service_orders_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultant_service_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_skills: {
        Row: {
          consultant_id: string
          countries_supported: string[]
          id: string
          languages: string[]
          updated_at: string
          visa_types: string[]
        }
        Insert: {
          consultant_id: string
          countries_supported?: string[]
          id?: string
          languages?: string[]
          updated_at?: string
          visa_types?: string[]
        }
        Update: {
          consultant_id?: string
          countries_supported?: string[]
          id?: string
          languages?: string[]
          updated_at?: string
          visa_types?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "consultant_skills_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_tax_profiles: {
        Row: {
          business_name: string | null
          consultant_id: string
          created_at: string
          form_type: string
          id: string
          status: string
          tax_country: string
          tax_id_encrypted: string | null
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          consultant_id: string
          created_at?: string
          form_type: string
          id?: string
          status?: string
          tax_country: string
          tax_id_encrypted?: string | null
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          consultant_id?: string
          created_at?: string
          form_type?: string
          id?: string
          status?: string
          tax_country?: string
          tax_id_encrypted?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_tax_profiles_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          application_id: string | null
          consultant_id: string
          created_at: string
          external_event_id: string | null
          id: string
          meeting_url: string | null
          provider: string
          scheduled_end: string
          scheduled_start: string
          service_order_id: string | null
          status: string
          timezone: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          consultant_id: string
          created_at?: string
          external_event_id?: string | null
          id?: string
          meeting_url?: string | null
          provider: string
          scheduled_end: string
          scheduled_start: string
          service_order_id?: string | null
          status?: string
          timezone?: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          consultant_id?: string
          created_at?: string
          external_event_id?: string | null
          id?: string
          meeting_url?: string | null
          provider?: string
          scheduled_end?: string
          scheduled_start?: string
          service_order_id?: string | null
          status?: string
          timezone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consultations_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_service_order_id_fkey"
            columns: ["service_order_id"]
            isOneToOne: false
            referencedRelation: "consultant_service_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consumed_readback_tokens: {
        Row: {
          application_id: string
          consumed_at: string
          token_hash: string
        }
        Insert: {
          application_id: string
          consumed_at?: string
          token_hash: string
        }
        Update: {
          application_id?: string
          consumed_at?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumed_readback_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consumed_readback_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "consumed_readback_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumed_readback_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          delivered_at: string | null
          joined_at: string
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          delivered_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          role: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          delivered_at?: string | null
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          application_id: string
          consultant_state: string | null
          created_at: string
          id: string
          last_message_at: string | null
          status: string
        }
        Insert: {
          application_id: string
          consultant_state?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          status?: string
        }
        Update: {
          application_id?: string
          consultant_state?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      country_frameworks: {
        Row: {
          country_code: string
          id: string
          purpose: string
          requirements_json: Json
          updated_at: string
          visa_type: string
        }
        Insert: {
          country_code: string
          id?: string
          purpose: string
          requirements_json?: Json
          updated_at?: string
          visa_type: string
        }
        Update: {
          country_code?: string
          id?: string
          purpose?: string
          requirements_json?: Json
          updated_at?: string
          visa_type?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          active: boolean
          amount_off_cents: number | null
          applies_to: string
          code: string
          created_at: string
          currency: string
          id: string
          kind: string
          max_redemptions: number | null
          percent_off: number | null
          redeemed_count: number
          stripe_coupon_id: string | null
          updated_at: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          amount_off_cents?: number | null
          applies_to?: string
          code: string
          created_at?: string
          currency?: string
          id?: string
          kind: string
          max_redemptions?: number | null
          percent_off?: number | null
          redeemed_count?: number
          stripe_coupon_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          amount_off_cents?: number | null
          applies_to?: string
          code?: string
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          max_redemptions?: number | null
          percent_off?: number | null
          redeemed_count?: number
          stripe_coupon_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      cross_verifications: {
        Row: {
          application_id: string
          checked_at: string
          details_json: Json
          doc_a_id: string
          doc_b_id: string
          field_compared: string
          id: string
          result: string
        }
        Insert: {
          application_id: string
          checked_at?: string
          details_json?: Json
          doc_a_id: string
          doc_b_id: string
          field_compared: string
          id?: string
          result: string
        }
        Update: {
          application_id?: string
          checked_at?: string
          details_json?: Json
          doc_a_id?: string
          doc_b_id?: string
          field_compared?: string
          id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "cross_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "cross_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "cross_verifications_doc_a_id_fkey"
            columns: ["doc_a_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_verifications_doc_b_id_fkey"
            columns: ["doc_b_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_name: string | null
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_redemptions: {
        Row: {
          application_id: string | null
          charged_price_cents: number
          config_snapshot_id: string | null
          coupon_id: string
          created_at: string
          discount_cents: number
          floor_ok: boolean
          id: string
          list_price_cents: number
          payment_id: string | null
          promotion_id: string | null
          resulting_margin: number
          user_id: string
        }
        Insert: {
          application_id?: string | null
          charged_price_cents: number
          config_snapshot_id?: string | null
          coupon_id: string
          created_at?: string
          discount_cents: number
          floor_ok: boolean
          id?: string
          list_price_cents: number
          payment_id?: string | null
          promotion_id?: string | null
          resulting_margin: number
          user_id: string
        }
        Update: {
          application_id?: string | null
          charged_price_cents?: number
          config_snapshot_id?: string | null
          coupon_id?: string
          created_at?: string
          discount_cents?: number
          floor_ok?: boolean
          id?: string
          list_price_cents?: number
          payment_id?: string | null
          promotion_id?: string | null
          resulting_margin?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemptions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "discount_redemptions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "discount_redemptions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "discount_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_logs: {
        Row: {
          action: string
          application_id: string
          document_id: string
          id: string
          occurred_at: string
          user_id: string
        }
        Insert: {
          action: string
          application_id: string
          document_id: string
          id?: string
          occurred_at?: string
          user_id: string
        }
        Update: {
          action?: string
          application_id?: string
          document_id?: string
          id?: string
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_access_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_access_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_access_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_access_logs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requests: {
        Row: {
          application_id: string
          checklist_item_id: string | null
          conversation_id: string
          created_at: string
          document_type: string
          due_date: string | null
          fulfilled_attachment_id: string | null
          id: string
          label: string
          notes: string | null
          priority: string
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          checklist_item_id?: string | null
          conversation_id: string
          created_at?: string
          document_type: string
          due_date?: string | null
          fulfilled_attachment_id?: string | null
          id?: string
          label: string
          notes?: string | null
          priority?: string
          requested_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          checklist_item_id?: string | null
          conversation_id?: string
          created_at?: string
          document_type?: string
          due_date?: string | null
          fulfilled_attachment_id?: string | null
          id?: string
          label?: string
          notes?: string | null
          priority?: string
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_requests_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_fulfilled_attachment_id_fkey"
            columns: ["fulfilled_attachment_id"]
            isOneToOne: false
            referencedRelation: "message_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          byte_size: number | null
          content_type: string | null
          country_code: string
          created_at: string
          document_code: string | null
          error_message: string | null
          fetched_at: string | null
          id: string
          kind: string
          last_checked_at: string | null
          last_verified_at: string | null
          program: string
          resolved_pdf_url: string | null
          sha256: string | null
          source_url: string
          status: string
          storage_path: string | null
          template_code: string
          template_name: string
          updated_at: string
          version_label: string | null
        }
        Insert: {
          byte_size?: number | null
          content_type?: string | null
          country_code: string
          created_at?: string
          document_code?: string | null
          error_message?: string | null
          fetched_at?: string | null
          id?: string
          kind?: string
          last_checked_at?: string | null
          last_verified_at?: string | null
          program: string
          resolved_pdf_url?: string | null
          sha256?: string | null
          source_url: string
          status?: string
          storage_path?: string | null
          template_code: string
          template_name?: string
          updated_at?: string
          version_label?: string | null
        }
        Update: {
          byte_size?: number | null
          content_type?: string | null
          country_code?: string
          created_at?: string
          document_code?: string | null
          error_message?: string | null
          fetched_at?: string | null
          id?: string
          kind?: string
          last_checked_at?: string | null
          last_verified_at?: string | null
          program?: string
          resolved_pdf_url?: string | null
          sha256?: string | null
          source_url?: string
          status?: string
          storage_path?: string | null
          template_code?: string
          template_name?: string
          updated_at?: string
          version_label?: string | null
        }
        Relationships: []
      }
      document_translations: {
        Row: {
          application_id: string
          created_at: string
          document_id: string
          id: string
          model: string | null
          provider: string | null
          source_lang: string
          target_lang: string
          translated_text: string
        }
        Insert: {
          application_id: string
          created_at?: string
          document_id: string
          id?: string
          model?: string | null
          provider?: string | null
          source_lang: string
          target_lang?: string
          translated_text: string
        }
        Update: {
          application_id?: string
          created_at?: string
          document_id?: string
          id?: string
          model?: string | null
          provider?: string | null
          source_lang?: string
          target_lang?: string
          translated_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_translations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_translations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_translations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_translations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "document_translations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_verifications: {
        Row: {
          details_json: Json
          document_id: string
          id: string
          result: string
          verification_type: string
          verified_at: string
        }
        Insert: {
          details_json?: Json
          document_id: string
          id?: string
          result: string
          verification_type: string
          verified_at?: string
        }
        Update: {
          details_json?: Json
          document_id?: string
          id?: string
          result?: string
          verification_type?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_verifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          application_id: string
          checklist_item_id: string | null
          created_at: string
          detected_language: string | null
          document_type: string | null
          dup_status: string
          duplicate_of: string | null
          encrypted: boolean
          expiry_date: string | null
          expiry_status: string | null
          file_name: string
          id: string
          identity_fphash: string | null
          language_confidence: number | null
          mime_type: string
          needs_translation: boolean
          ocr_status: string
          raw_text_hash: string | null
          storage_path: string
          upload_status: string
        }
        Insert: {
          application_id: string
          checklist_item_id?: string | null
          created_at?: string
          detected_language?: string | null
          document_type?: string | null
          dup_status?: string
          duplicate_of?: string | null
          encrypted?: boolean
          expiry_date?: string | null
          expiry_status?: string | null
          file_name: string
          id?: string
          identity_fphash?: string | null
          language_confidence?: number | null
          mime_type: string
          needs_translation?: boolean
          ocr_status?: string
          raw_text_hash?: string | null
          storage_path: string
          upload_status?: string
        }
        Update: {
          application_id?: string
          checklist_item_id?: string | null
          created_at?: string
          detected_language?: string | null
          document_type?: string | null
          dup_status?: string
          duplicate_of?: string | null
          encrypted?: boolean
          expiry_date?: string | null
          expiry_status?: string | null
          file_name?: string
          id?: string
          identity_fphash?: string | null
          language_confidence?: number | null
          mime_type?: string
          needs_translation?: boolean
          ocr_status?: string
          raw_text_hash?: string | null
          storage_path?: string
          upload_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "documents_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_history: {
        Row: {
          application_id: string
          conversation_id: string
          created_at: string
          escalated_by: string
          escalation_type: string
          id: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          conversation_id: string
          created_at?: string
          escalated_by: string
          escalation_type: string
          id?: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          conversation_id?: string
          created_at?: string
          escalated_by?: string
          escalation_type?: string
          id?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "escalation_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "escalation_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "escalation_history_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_thresholds: {
        Row: {
          active: boolean
          created_at: string
          effective_from: string
          id: string
          key: string
          note: string | null
          value: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          key: string
          note?: string | null
          value: number
        }
        Update: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          key?: string
          note?: string | null
          value?: number
        }
        Relationships: []
      }
      evidence_packages: {
        Row: {
          application_id: string | null
          approval_timestamp: string | null
          audit_hash: string
          canon_version: number
          chain_verified: boolean
          consultant_id: string | null
          execution_timestamp: string | null
          extension_version: string | null
          generated_at: string
          hash_algo: string
          id: string
          package_version: string
          region: string
          schema_version: string | null
          signature: string
          storage_path: string
          submission_session_id: string | null
          version: number
        }
        Insert: {
          application_id?: string | null
          approval_timestamp?: string | null
          audit_hash: string
          canon_version?: number
          chain_verified?: boolean
          consultant_id?: string | null
          execution_timestamp?: string | null
          extension_version?: string | null
          generated_at?: string
          hash_algo?: string
          id?: string
          package_version?: string
          region?: string
          schema_version?: string | null
          signature: string
          storage_path: string
          submission_session_id?: string | null
          version?: number
        }
        Update: {
          application_id?: string | null
          approval_timestamp?: string | null
          audit_hash?: string
          canon_version?: number
          chain_verified?: boolean
          consultant_id?: string | null
          execution_timestamp?: string | null
          extension_version?: string | null
          generated_at?: string
          hash_algo?: string
          id?: string
          package_version?: string
          region?: string
          schema_version?: string | null
          signature?: string
          storage_path?: string
          submission_session_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "evidence_packages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "evidence_packages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "evidence_packages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_packages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "evidence_packages_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_packages_submission_session_id_fkey"
            columns: ["submission_session_id"]
            isOneToOne: false
            referencedRelation: "submission_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flag_audit: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          flag_key: string
          id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          flag_key: string
          id?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          flag_key?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          allowed_cohorts: string[]
          allowed_roles: string[]
          allowed_user_ids: string[]
          created_at: string
          description: string
          enabled: boolean
          environments: string[]
          key: string
          rollout_percentage: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_cohorts?: string[]
          allowed_roles?: string[]
          allowed_user_ids?: string[]
          created_at?: string
          description?: string
          enabled?: boolean
          environments?: string[]
          key: string
          rollout_percentage?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_cohorts?: string[]
          allowed_roles?: string[]
          allowed_user_ids?: string[]
          created_at?: string
          description?: string
          enabled?: boolean
          environments?: string[]
          key?: string
          rollout_percentage?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      field_provenance: {
        Row: {
          application_id: string
          confidence: number | null
          confidence_band: string | null
          created_at: string
          extraction_timestamp: string
          field_key: string
          id: string
          ocr_run_id: string | null
          origin: string
          source_bbox: Json | null
          source_document_id: string | null
          source_page: number | null
          superseded_by: string | null
          value_hash: string | null
          value_snapshot: string | null
        }
        Insert: {
          application_id: string
          confidence?: number | null
          confidence_band?: string | null
          created_at?: string
          extraction_timestamp?: string
          field_key: string
          id?: string
          ocr_run_id?: string | null
          origin: string
          source_bbox?: Json | null
          source_document_id?: string | null
          source_page?: number | null
          superseded_by?: string | null
          value_hash?: string | null
          value_snapshot?: string | null
        }
        Update: {
          application_id?: string
          confidence?: number | null
          confidence_band?: string | null
          created_at?: string
          extraction_timestamp?: string
          field_key?: string
          id?: string
          ocr_run_id?: string | null
          origin?: string
          source_bbox?: Json | null
          source_document_id?: string | null
          source_page?: number | null
          superseded_by?: string | null
          value_hash?: string | null
          value_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_provenance_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_provenance_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_provenance_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_provenance_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_provenance_ocr_run_id_fkey"
            columns: ["ocr_run_id"]
            isOneToOne: false
            referencedRelation: "ocr_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_provenance_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_provenance_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "field_provenance"
            referencedColumns: ["id"]
          },
        ]
      }
      field_verifications: {
        Row: {
          application_id: string
          consultant_approved_at: string | null
          consultant_approved_by: string | null
          consultant_reviewed_at: string | null
          consultant_reviewed_by: string | null
          created_at: string
          executed_at: string | null
          field_key: string
          id: string
          section: string | null
          source: string | null
          source_document_id: string | null
          state: Database["public"]["Enums"]["verification_state"]
          updated_at: string
          user_confirmed_at: string | null
          user_confirmed_by: string | null
          value_hash: string | null
          value_snapshot: string | null
        }
        Insert: {
          application_id: string
          consultant_approved_at?: string | null
          consultant_approved_by?: string | null
          consultant_reviewed_at?: string | null
          consultant_reviewed_by?: string | null
          created_at?: string
          executed_at?: string | null
          field_key: string
          id?: string
          section?: string | null
          source?: string | null
          source_document_id?: string | null
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
          user_confirmed_at?: string | null
          user_confirmed_by?: string | null
          value_hash?: string | null
          value_snapshot?: string | null
        }
        Update: {
          application_id?: string
          consultant_approved_at?: string | null
          consultant_approved_by?: string | null
          consultant_reviewed_at?: string | null
          consultant_reviewed_by?: string | null
          created_at?: string
          executed_at?: string | null
          field_key?: string
          id?: string
          section?: string | null
          source?: string | null
          source_document_id?: string | null
          state?: Database["public"]["Enums"]["verification_state"]
          updated_at?: string
          user_confirmed_at?: string | null
          user_confirmed_by?: string | null
          value_hash?: string | null
          value_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_verifications_consultant_approved_by_fkey"
            columns: ["consultant_approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_verifications_consultant_reviewed_by_fkey"
            columns: ["consultant_reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_verifications_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_verifications_user_confirmed_by_fkey"
            columns: ["user_confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          byte_size: number | null
          capability: string
          country_code: string
          created_at: string
          error_message: string | null
          fetched_at: string | null
          field_count: number | null
          form_code: string
          form_name: string
          id: string
          landing_url: string
          last_checked_at: string | null
          last_verified_at: string | null
          program: string
          resolved_pdf_url: string | null
          sha256: string | null
          status: string
          storage_path: string | null
          updated_at: string
          version_label: string | null
        }
        Insert: {
          byte_size?: number | null
          capability?: string
          country_code: string
          created_at?: string
          error_message?: string | null
          fetched_at?: string | null
          field_count?: number | null
          form_code: string
          form_name?: string
          id?: string
          landing_url: string
          last_checked_at?: string | null
          last_verified_at?: string | null
          program: string
          resolved_pdf_url?: string | null
          sha256?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          version_label?: string | null
        }
        Update: {
          byte_size?: number | null
          capability?: string
          country_code?: string
          created_at?: string
          error_message?: string | null
          fetched_at?: string | null
          field_count?: number | null
          form_code?: string
          form_name?: string
          id?: string
          landing_url?: string
          last_checked_at?: string | null
          last_verified_at?: string | null
          program?: string
          resolved_pdf_url?: string | null
          sha256?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          version_label?: string | null
        }
        Relationships: []
      }
      generated_documents: {
        Row: {
          application_id: string
          approved_by_user: boolean
          content_md: string
          doc_type: string
          generated_at: string
          id: string
        }
        Insert: {
          application_id: string
          approved_by_user?: boolean
          content_md: string
          doc_type: string
          generated_at?: string
          id?: string
        }
        Update: {
          application_id?: string
          approved_by_user?: boolean
          content_md?: string
          doc_type?: string
          generated_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "generated_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "generated_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      intake_messages: {
        Row: {
          application_id: string
          content: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          application_id: string
          content: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          application_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "intake_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "intake_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      kpi_funnel_daily: {
        Row: {
          converted: number
          day: string
          dim_key: string
          dim_val: string
          entered: number
          funnel: string
          step: string
          step_index: number
        }
        Insert: {
          converted?: number
          day: string
          dim_key?: string
          dim_val?: string
          entered?: number
          funnel: string
          step: string
          step_index: number
        }
        Update: {
          converted?: number
          day?: string
          dim_key?: string
          dim_val?: string
          entered?: number
          funnel?: string
          step?: string
          step_index?: number
        }
        Relationships: []
      }
      kpi_metric_daily: {
        Row: {
          day: string
          dim_key: string
          dim_val: string
          metric: string
          value_num: number
        }
        Insert: {
          day: string
          dim_key?: string
          dim_val?: string
          metric: string
          value_num: number
        }
        Update: {
          day?: string
          dim_key?: string
          dim_val?: string
          metric?: string
          value_num?: number
        }
        Relationships: []
      }
      kpi_retention_cohort: {
        Row: {
          cohort_month: string
          cohort_size: number
          dim_key: string
          dim_val: string
          period_index: number
          retained: number
          retained_cents: number
        }
        Insert: {
          cohort_month: string
          cohort_size?: number
          dim_key?: string
          dim_val?: string
          period_index: number
          retained?: number
          retained_cents?: number
        }
        Update: {
          cohort_month?: string
          cohort_size?: number
          dim_key?: string
          dim_val?: string
          period_index?: number
          retained?: number
          retained_cents?: number
        }
        Relationships: []
      }
      login_history: {
        Row: {
          created_at: string
          email: string | null
          failure_reason: string | null
          id: string
          ip: string | null
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          failure_reason?: string | null
          id?: string
          ip?: string | null
          success: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          failure_reason?: string | null
          id?: string
          ip?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "login_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_attribution: {
        Row: {
          anon_id: string | null
          first_touch_at: string
          landing_path: string | null
          last_touch_at: string
          referrer_host: string | null
          user_id: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          anon_id?: string | null
          first_touch_at?: string
          landing_path?: string | null
          last_touch_at?: string
          referrer_host?: string | null
          user_id: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          anon_id?: string | null
          first_touch_at?: string
          landing_path?: string | null
          last_touch_at?: string
          referrer_host?: string | null
          user_id?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_attribution_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          conversation_id: string
          created_at: string
          file_name: string
          id: string
          kind: string
          message_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          file_name: string
          id?: string
          kind: string
          message_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          file_name?: string
          id?: string
          kind?: string
          message_id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          category: string
          client_id: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_message_id: string | null
          search_tsv: unknown
          sender_id: string
          sender_role: string
        }
        Insert: {
          body: string
          category?: string
          client_id?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          search_tsv?: unknown
          sender_id: string
          sender_role: string
        }
        Update: {
          body?: string
          category?: string
          client_id?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          search_tsv?: unknown
          sender_id?: string
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_broadcasts: {
        Row: {
          audience: Json
          body: string
          category: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          link: string | null
          recipient_count: number
          status: string
          title: string
        }
        Insert: {
          audience: Json
          body: string
          category?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string | null
          recipient_count?: number
          status?: string
          title: string
        }
        Update: {
          audience?: Json
          body?: string
          category?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string | null
          recipient_count?: number
          status?: string
          title?: string
        }
        Relationships: []
      }
      notification_deliveries: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string | null
          error: string | null
          event_type: string
          id: string
          notification_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          event_type: string
          id?: string
          notification_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          event_type?: string
          id?: string
          notification_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_type: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          categories: Json
          email_enabled: boolean
          language: string | null
          push_enabled: boolean
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          sms_enabled: boolean
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          categories?: Json
          email_enabled?: boolean
          language?: string | null
          push_enabled?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sms_enabled?: boolean
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: Json
          email_enabled?: boolean
          language?: string | null
          push_enabled?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sms_enabled?: boolean
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          is_active: boolean
          locale: string
          subject: string | null
          title: string
          variables: string[]
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          is_active?: boolean
          locale?: string
          subject?: string | null
          title: string
          variables?: string[]
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          locale?: string
          subject?: string | null
          title?: string
          variables?: string[]
          version?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          conversation_id: string | null
          created_at: string
          data: Json
          id: string
          link: string | null
          message_id: string | null
          read_at: string | null
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          data?: Json
          id?: string
          link?: string | null
          message_id?: string | null
          read_at?: string | null
          title?: string | null
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          data?: Json
          id?: string
          link?: string | null
          message_id?: string | null
          read_at?: string | null
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_runs: {
        Row: {
          application_id: string
          completed_at: string | null
          created_at: string
          document_id: string
          id: string
          page_count: number | null
          provider: string
          provider_model: string | null
          raw_text_hash: string | null
          region: string
          started_at: string | null
          status: string
        }
        Insert: {
          application_id: string
          completed_at?: string | null
          created_at?: string
          document_id: string
          id?: string
          page_count?: number | null
          provider: string
          provider_model?: string | null
          raw_text_hash?: string | null
          region?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          application_id?: string
          completed_at?: string | null
          created_at?: string
          document_id?: string
          id?: string
          page_count?: number | null
          provider?: string
          provider_model?: string | null
          raw_text_hash?: string | null
          region?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocr_runs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ocr_runs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ocr_runs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_runs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ocr_runs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_agent_runs: {
        Row: {
          agent: string
          cost_usd: number | null
          finished_at: string | null
          id: string
          output_ref: string | null
          product_id: string | null
          started_at: string
          status: string
          task: string | null
          tokens: number | null
        }
        Insert: {
          agent: string
          cost_usd?: number | null
          finished_at?: string | null
          id?: string
          output_ref?: string | null
          product_id?: string | null
          started_at?: string
          status?: string
          task?: string | null
          tokens?: number | null
        }
        Update: {
          agent?: string
          cost_usd?: number | null
          finished_at?: string | null
          id?: string
          output_ref?: string | null
          product_id?: string | null
          started_at?: string
          status?: string
          task?: string | null
          tokens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_agent_runs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_experiments: {
        Row: {
          created_at: string
          ended_at: string | null
          hypothesis: string
          ice_score: number | null
          id: string
          metric: string | null
          product_id: string | null
          result: string | null
          started_at: string | null
          status: string
          variant: string | null
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          hypothesis: string
          ice_score?: number | null
          id?: string
          metric?: string | null
          product_id?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          variant?: string | null
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          hypothesis?: string
          ice_score?: number | null
          id?: string
          metric?: string | null
          product_id?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_experiments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_marketing_events: {
        Row: {
          campaign: string | null
          channel: string
          event_type: string
          id: string
          metrics: Json
          occurred_at: string
          product_id: string | null
        }
        Insert: {
          campaign?: string | null
          channel: string
          event_type: string
          id?: string
          metrics?: Json
          occurred_at?: string
          product_id?: string | null
        }
        Update: {
          campaign?: string | null
          channel?: string
          event_type?: string
          id?: string
          metrics?: Json
          occurred_at?: string
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_marketing_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_products: {
        Row: {
          created_at: string
          id: string
          legal_risk: string | null
          market: string | null
          name: string
          notes: string | null
          opportunity_score: number | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          legal_risk?: string | null
          market?: string | null
          name: string
          notes?: string | null
          opportunity_score?: number | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          legal_risk?: string | null
          market?: string | null
          name?: string
          notes?: string | null
          opportunity_score?: number | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ops_revenue: {
        Row: {
          amount_cents: number
          currency: string
          id: string
          mrr_cents: number | null
          occurred_at: string
          product_id: string | null
          source: string
          stripe_ref: string | null
        }
        Insert: {
          amount_cents?: number
          currency?: string
          id?: string
          mrr_cents?: number | null
          occurred_at?: string
          product_id?: string | null
          source: string
          stripe_ref?: string | null
        }
        Update: {
          amount_cents?: number
          currency?: string
          id?: string
          mrr_cents?: number | null
          occurred_at?: string
          product_id?: string | null
          source?: string
          stripe_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_revenue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "ops_products"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: string
          status?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          id: string
          joined_at: string
          organization_id: string
          role: string
          status: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          organization_id: string
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          organization_id?: string
          role?: string
          status?: string
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
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          plan: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          plan?: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          plan?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_access_tokens: {
        Row: {
          application_id: string
          created_at: string
          expires_at: string
          grant_type: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          scopes: string[]
          subject_user_id: string | null
          token_hash: string
        }
        Insert: {
          application_id: string
          created_at?: string
          expires_at: string
          grant_type: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          subject_user_id?: string | null
          token_hash: string
        }
        Update: {
          application_id?: string
          created_at?: string
          expires_at?: string
          grant_type?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          scopes?: string[]
          subject_user_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_access_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_access_tokens_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_api_keys: {
        Row: {
          application_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          last_four: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          revoked_reason: string | null
          rotated_from: string | null
          scopes: string[]
          status: string
        }
        Insert: {
          application_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          last_four: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_from?: string | null
          scopes?: string[]
          status?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          last_four?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_from?: string | null
          scopes?: string[]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_api_keys_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_api_keys_rotated_from_fkey"
            columns: ["rotated_from"]
            isOneToOne: false
            referencedRelation: "partner_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_api_requests: {
        Row: {
          api_version: string
          application_id: string
          created_at: string
          credential_id: string | null
          credential_kind: string
          environment: string
          error_code: string | null
          id: string
          latency_ms: number
          method: string
          request_id: string
          route_template: string
          status_code: number
        }
        Insert: {
          api_version?: string
          application_id: string
          created_at?: string
          credential_id?: string | null
          credential_kind: string
          environment: string
          error_code?: string | null
          id?: string
          latency_ms: number
          method: string
          request_id: string
          route_template: string
          status_code: number
        }
        Update: {
          api_version?: string
          application_id?: string
          created_at?: string
          credential_id?: string | null
          credential_kind?: string
          environment?: string
          error_code?: string | null
          id?: string
          latency_ms?: number
          method?: string
          request_id?: string
          route_template?: string
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "partner_api_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_applications: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          client_id: string
          client_secret_hash: string | null
          client_type: string
          created_at: string
          created_by: string | null
          description: string | null
          environment: string
          grant_types: string[]
          id: string
          ip_allowlist: string[]
          name: string
          partner_id: string
          redirect_uris: string[]
          requested_scopes: string[]
          revoked_at: string | null
          scopes: string[]
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          client_id: string
          client_secret_hash?: string | null
          client_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment: string
          grant_types?: string[]
          id?: string
          ip_allowlist?: string[]
          name: string
          partner_id: string
          redirect_uris?: string[]
          requested_scopes?: string[]
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          client_id?: string
          client_secret_hash?: string | null
          client_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          grant_types?: string[]
          id?: string
          ip_allowlist?: string[]
          name?: string
          partner_id?: string
          redirect_uris?: string[]
          requested_scopes?: string[]
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_applications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_applications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_applications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_authorization_codes: {
        Row: {
          application_id: string
          code_challenge: string
          code_challenge_method: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          scopes: string[]
          subject_user_id: string
        }
        Insert: {
          application_id: string
          code_challenge: string
          code_challenge_method?: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          redirect_uri: string
          scopes?: string[]
          subject_user_id: string
        }
        Update: {
          application_id?: string
          code_challenge?: string
          code_challenge_method?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          scopes?: string[]
          subject_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_authorization_codes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_authorization_codes_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_events: {
        Row: {
          created_at: string
          environment: string
          event_type: string
          id: string
          organization_id: string | null
          payload: Json
          resource_id: string | null
          resource_type: string
          sequence: number
          subject_user_id: string | null
        }
        Insert: {
          created_at?: string
          environment?: string
          event_type: string
          id?: string
          organization_id?: string | null
          payload?: Json
          resource_id?: string | null
          resource_type: string
          sequence?: number
          subject_user_id?: string | null
        }
        Update: {
          created_at?: string
          environment?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          payload?: Json
          resource_id?: string | null
          resource_type?: string
          sequence?: number
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_idempotency_keys: {
        Row: {
          application_id: string
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          request_hash: string
          response_body: Json | null
          route_template: string
          state: string
          status_code: number | null
        }
        Insert: {
          application_id: string
          created_at?: string
          expires_at: string
          id?: string
          idempotency_key: string
          request_hash: string
          response_body?: Json | null
          route_template: string
          state?: string
          status_code?: number | null
        }
        Update: {
          application_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          request_hash?: string
          response_body?: Json | null
          route_template?: string
          state?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_idempotency_keys_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_sandbox_resources: {
        Row: {
          application_id: string
          created_at: string
          data: Json
          id: string
          resource_key: string
          resource_type: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          data?: Json
          id?: string
          resource_key: string
          resource_type: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          data?: Json
          id?: string
          resource_key?: string
          resource_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_sandbox_resources_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_usage_counters: {
        Row: {
          application_id: string
          count: number
          window_kind: string
          window_start: string
        }
        Insert: {
          application_id: string
          count?: number
          window_kind: string
          window_start: string
        }
        Update: {
          application_id?: string
          count?: number
          window_kind?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_usage_counters_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_user_consents: {
        Row: {
          application_id: string
          granted_at: string
          id: string
          revoked_at: string | null
          scopes: string[]
          user_id: string
        }
        Insert: {
          application_id: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes?: string[]
          user_id: string
        }
        Update: {
          application_id?: string
          granted_at?: string
          id?: string
          revoked_at?: string | null
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_user_consents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_webhook_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          delivered_at: string | null
          duration_ms: number | null
          endpoint_id: string
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          last_status_code: number | null
          next_attempt_at: string
          replayed_from: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          duration_ms?: number | null
          endpoint_id: string
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          next_attempt_at?: string
          replayed_from?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivered_at?: string | null
          duration_ms?: number | null
          endpoint_id?: string
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          last_status_code?: number | null
          next_attempt_at?: string
          replayed_from?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "partner_webhook_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_webhook_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "partner_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_webhook_deliveries_replayed_from_fkey"
            columns: ["replayed_from"]
            isOneToOne: false
            referencedRelation: "partner_webhook_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_webhook_endpoints: {
        Row: {
          application_id: string
          consecutive_failures: number
          created_at: string
          description: string | null
          disabled_at: string | null
          disabled_reason: string | null
          events: string[]
          id: string
          previous_secret_encrypted: string | null
          previous_secret_expires_at: string | null
          secret_encrypted: string
          status: string
          updated_at: string
          url: string
          verification_token: string | null
          verified_at: string | null
        }
        Insert: {
          application_id: string
          consecutive_failures?: number
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          events?: string[]
          id?: string
          previous_secret_encrypted?: string | null
          previous_secret_expires_at?: string | null
          secret_encrypted: string
          status?: string
          updated_at?: string
          url: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Update: {
          application_id?: string
          consecutive_failures?: number
          created_at?: string
          description?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          events?: string[]
          id?: string
          previous_secret_encrypted?: string | null
          previous_secret_expires_at?: string | null
          secret_encrypted?: string
          status?: string
          updated_at?: string
          url?: string
          verification_token?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_webhook_endpoints_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "partner_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          compliance: Json
          contact_email: string
          created_at: string
          id: string
          legal_name: string
          organization_id: string
          status: string
          status_reason: string | null
          tier: string
          updated_at: string
          website: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          compliance?: Json
          contact_email: string
          created_at?: string
          id?: string
          legal_name: string
          organization_id: string
          status?: string
          status_reason?: string | null
          tier?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          compliance?: Json
          contact_email?: string
          created_at?: string
          id?: string
          legal_name?: string
          organization_id?: string
          status?: string
          status_reason?: string | null
          tier?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_disputes: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string | null
          id: string
          payment_id: string | null
          provider_object_id: string
          reason: string | null
          status: string
          stripe_dispute_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          payment_id?: string | null
          provider_object_id: string
          reason?: string | null
          status?: string
          stripe_dispute_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          id?: string
          payment_id?: string | null
          provider_object_id?: string
          reason?: string | null
          status?: string
          stripe_dispute_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_disputes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_dunning: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_attempt_at: string | null
          status: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          status?: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          status?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_dunning_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          amount_minor: number | null
          currency: string | null
          direction: string
          event_type: string
          id: string
          occurred_at: string
          provider: string
          provider_event_id: string
          provider_object_id: string
          recorded_at: string
          related_entity: Json
          user_id: string | null
        }
        Insert: {
          amount_minor?: number | null
          currency?: string | null
          direction: string
          event_type: string
          id?: string
          occurred_at: string
          provider: string
          provider_event_id: string
          provider_object_id: string
          recorded_at?: string
          related_entity?: Json
          user_id?: string | null
        }
        Update: {
          amount_minor?: number | null
          currency?: string | null
          direction?: string
          event_type?: string
          id?: string
          occurred_at?: string
          provider?: string
          provider_event_id?: string
          provider_object_id?: string
          recorded_at?: string
          related_entity?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount_cents: number | null
          application_id: string
          country_code: string | null
          created_at: string
          currency: string
          discount_cents: number | null
          disputed_at: string | null
          feature: string
          id: string
          invoice_id: string | null
          invoice_url: string | null
          plan_tier: string | null
          provider: string
          status: string
          stripe_payment_intent_id: string | null
          tax_cents: number | null
          user_id: string
          visa_type: string | null
        }
        Insert: {
          amount_cents?: number | null
          application_id: string
          country_code?: string | null
          created_at?: string
          currency?: string
          discount_cents?: number | null
          disputed_at?: string | null
          feature?: string
          id?: string
          invoice_id?: string | null
          invoice_url?: string | null
          plan_tier?: string | null
          provider?: string
          status?: string
          stripe_payment_intent_id?: string | null
          tax_cents?: number | null
          user_id: string
          visa_type?: string | null
        }
        Update: {
          amount_cents?: number | null
          application_id?: string
          country_code?: string | null
          created_at?: string
          currency?: string
          discount_cents?: number | null
          disputed_at?: string | null
          feature?: string
          id?: string
          invoice_id?: string | null
          invoice_url?: string | null
          plan_tier?: string | null
          provider?: string
          status?: string
          stripe_payment_intent_id?: string | null
          tax_cents?: number | null
          user_id?: string
          visa_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "payments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "payments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_tax_statements: {
        Row: {
          consultant_id: string
          currency: string
          generated_at: string
          gross_paid_cents: number
          id: string
          payout_count: number
          tax_year: number
        }
        Insert: {
          consultant_id: string
          currency?: string
          generated_at?: string
          gross_paid_cents?: number
          id?: string
          payout_count?: number
          tax_year: number
        }
        Update: {
          consultant_id?: string
          currency?: string
          generated_at?: string
          gross_paid_cents?: number
          id?: string
          payout_count?: number
          tax_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "payout_tax_statements_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultant_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      post_submission_events: {
        Row: {
          application_id: string
          deadline: string | null
          event_type: string
          id: string
          raw_email_encrypted: string | null
          received_at: string
          status: string
          summary: string | null
        }
        Insert: {
          application_id: string
          deadline?: string | null
          event_type: string
          id?: string
          raw_email_encrypted?: string | null
          received_at?: string
          status?: string
          summary?: string | null
        }
        Update: {
          application_id?: string
          deadline?: string | null
          event_type?: string
          id?: string
          raw_email_encrypted?: string | null
          received_at?: string
          status?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_submission_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "post_submission_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "post_submission_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_submission_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      preflight_reviews: {
        Row: {
          addresses_reviewed: boolean
          application_id: string
          completed_at: string | null
          dates_reviewed: boolean
          employment_reviewed: boolean
          extension_version: string | null
          final_approval: boolean
          id: string
          invalidated_at: string | null
          locked_diff_hash: string | null
          passport_reviewed: boolean
          reviewer_id: string | null
          reviewer_role: Database["public"]["Enums"]["audit_actor_role"] | null
          schema_version: string | null
          started_at: string
          status: Database["public"]["Enums"]["preflight_status"]
          submission_session_id: string | null
          travel_history_reviewed: boolean
        }
        Insert: {
          addresses_reviewed?: boolean
          application_id: string
          completed_at?: string | null
          dates_reviewed?: boolean
          employment_reviewed?: boolean
          extension_version?: string | null
          final_approval?: boolean
          id?: string
          invalidated_at?: string | null
          locked_diff_hash?: string | null
          passport_reviewed?: boolean
          reviewer_id?: string | null
          reviewer_role?: Database["public"]["Enums"]["audit_actor_role"] | null
          schema_version?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["preflight_status"]
          submission_session_id?: string | null
          travel_history_reviewed?: boolean
        }
        Update: {
          addresses_reviewed?: boolean
          application_id?: string
          completed_at?: string | null
          dates_reviewed?: boolean
          employment_reviewed?: boolean
          extension_version?: string | null
          final_approval?: boolean
          id?: string
          invalidated_at?: string | null
          locked_diff_hash?: string | null
          passport_reviewed?: boolean
          reviewer_id?: string | null
          reviewer_role?: Database["public"]["Enums"]["audit_actor_role"] | null
          schema_version?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["preflight_status"]
          submission_session_id?: string | null
          travel_history_reviewed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "preflight_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "preflight_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "preflight_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preflight_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "preflight_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preflight_reviews_submission_session_id_fkey"
            columns: ["submission_session_id"]
            isOneToOne: false
            referencedRelation: "submission_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_constants: {
        Row: {
          active: boolean
          created_at: string
          effective_from: string
          id: string
          key: string
          note: string | null
          value: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          key: string
          note?: string | null
          value: number
        }
        Update: {
          active?: boolean
          created_at?: string
          effective_from?: string
          id?: string
          key?: string
          note?: string | null
          value?: number
        }
        Relationships: []
      }
      pricing_country_factors: {
        Row: {
          ai_complexity_multiplier: number
          country_code: string
          created_at: string
          id: string
          labor_band: string
          labor_multiplier: number
          ppp_factor: number
          price_band_max: number
          price_band_min: number
          priceable: boolean
          reviewer_rate_usd: number
          updated_at: string
        }
        Insert: {
          ai_complexity_multiplier?: number
          country_code: string
          created_at?: string
          id?: string
          labor_band: string
          labor_multiplier: number
          ppp_factor?: number
          price_band_max: number
          price_band_min: number
          priceable?: boolean
          reviewer_rate_usd: number
          updated_at?: string
        }
        Update: {
          ai_complexity_multiplier?: number
          country_code?: string
          created_at?: string
          id?: string
          labor_band?: string
          labor_multiplier?: number
          ppp_factor?: number
          price_band_max?: number
          price_band_min?: number
          priceable?: boolean
          reviewer_rate_usd?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_quote_audit: {
        Row: {
          breakdown: Json
          config_snapshot_id: string | null
          country_code: string
          created_at: string
          event: string
          gross_margin: number
          id: string
          recommended_price: number
          shown_to_user: string | null
          visa_type: string
        }
        Insert: {
          breakdown?: Json
          config_snapshot_id?: string | null
          country_code: string
          created_at?: string
          event?: string
          gross_margin: number
          id?: string
          recommended_price: number
          shown_to_user?: string | null
          visa_type: string
        }
        Update: {
          breakdown?: Json
          config_snapshot_id?: string | null
          country_code?: string
          created_at?: string
          event?: string
          gross_margin?: number
          id?: string
          recommended_price?: number
          shown_to_user?: string | null
          visa_type?: string
        }
        Relationships: []
      }
      pricing_quotes: {
        Row: {
          breakdown: Json
          ceiling_price: number | null
          computed_at: string
          config_snapshot_id: string | null
          country_code: string
          flags: string[]
          floor_price: number
          gross_margin: number
          id: string
          recommended_price: number
          total_cogs: number
          visa_type: string
        }
        Insert: {
          breakdown?: Json
          ceiling_price?: number | null
          computed_at?: string
          config_snapshot_id?: string | null
          country_code: string
          flags?: string[]
          floor_price: number
          gross_margin: number
          id?: string
          recommended_price: number
          total_cogs: number
          visa_type: string
        }
        Update: {
          breakdown?: Json
          ceiling_price?: number | null
          computed_at?: string
          config_snapshot_id?: string | null
          country_code?: string
          flags?: string[]
          floor_price?: number
          gross_margin?: number
          id?: string
          recommended_price?: number
          total_cogs?: number
          visa_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_quotes_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "pricing_country_factors"
            referencedColumns: ["country_code"]
          },
          {
            foreignKeyName: "pricing_quotes_visa_type_fkey"
            columns: ["visa_type"]
            isOneToOne: false
            referencedRelation: "pricing_visa_tiers"
            referencedColumns: ["visa_type"]
          },
        ]
      }
      pricing_visa_tiers: {
        Row: {
          ai_cost_base_usd: number
          base_anchor_usd: number
          complexity_tier: string
          compressed_review_hours: number
          created_at: string
          human_fee_usd: number
          id: string
          lawyer_flag: boolean
          priceable: boolean
          updated_at: string
          visa_type: string
        }
        Insert: {
          ai_cost_base_usd?: number
          base_anchor_usd?: number
          complexity_tier: string
          compressed_review_hours: number
          created_at?: string
          human_fee_usd?: number
          id?: string
          lawyer_flag?: boolean
          priceable?: boolean
          updated_at?: string
          visa_type: string
        }
        Update: {
          ai_cost_base_usd?: number
          base_anchor_usd?: number
          complexity_tier?: string
          compressed_review_hours?: number
          created_at?: string
          human_fee_usd?: number
          id?: string
          lawyer_flag?: boolean
          priceable?: boolean
          updated_at?: string
          visa_type?: string
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          details: Json
          id: string
          kind: string
          requested_at: string
          status: string
          subject_email: string
          user_id: string | null
        }
        Insert: {
          details?: Json
          id?: string
          kind: string
          requested_at?: string
          status?: string
          subject_email: string
          user_id?: string | null
        }
        Update: {
          details?: Json
          id?: string
          kind?: string
          requested_at?: string
          status?: string
          subject_email?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "privacy_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          audience: string
          country_code: string | null
          coupon_id: string
          created_at: string
          ends_at: string | null
          id: string
          name: string
          starts_at: string
          stripe_promotion_code_id: string | null
          updated_at: string
          visa_type: string | null
        }
        Insert: {
          active?: boolean
          audience?: string
          country_code?: string | null
          coupon_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          name: string
          starts_at?: string
          stripe_promotion_code_id?: string | null
          updated_at?: string
          visa_type?: string | null
        }
        Update: {
          active?: boolean
          audience?: string
          country_code?: string | null
          coupon_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          name?: string
          starts_at?: string
          stripe_promotion_code_id?: string | null
          updated_at?: string
          visa_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reconciliation_exceptions: {
        Row: {
          actual: Json | null
          created_at: string
          expected: Json | null
          id: string
          kind: string
          provider_object_id: string
          resolved: boolean
          run_id: string | null
        }
        Insert: {
          actual?: Json | null
          created_at?: string
          expected?: Json | null
          id?: string
          kind: string
          provider_object_id: string
          resolved?: boolean
          run_id?: string | null
        }
        Update: {
          actual?: Json | null
          created_at?: string
          expected?: Json | null
          id?: string
          kind?: string
          provider_object_id?: string
          resolved?: boolean
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_exceptions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          exception_count: number
          finished_at: string | null
          id: string
          matched_count: number
          provider: string
          range_end: string
          range_start: string
          run_date: string
          started_at: string
          status: string
        }
        Insert: {
          exception_count?: number
          finished_at?: string | null
          id?: string
          matched_count?: number
          provider: string
          range_end: string
          range_start: string
          run_date: string
          started_at?: string
          status?: string
        }
        Update: {
          exception_count?: number
          finished_at?: string | null
          id?: string
          matched_count?: number
          provider?: string
          range_end?: string
          range_start?: string
          run_date?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          initiated_by: string | null
          payment_id: string | null
          reason: string | null
          status: string
          stripe_refund_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          initiated_by?: string | null
          payment_id?: string | null
          reason?: string | null
          status?: string
          stripe_refund_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          initiated_by?: string | null
          payment_id?: string | null
          reason?: string | null
          status?: string
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_log: {
        Row: {
          application_id: string
          id: string
          kind: string
          sent_at: string
          stage: string
          user_id: string
        }
        Insert: {
          application_id: string
          id?: string
          kind: string
          sent_at?: string
          stage: string
          user_id: string
        }
        Update: {
          application_id?: string
          id?: string
          kind?: string
          sent_at?: string
          stage?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_log_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "reminder_log_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "reminder_log_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_log_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "reminder_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_weights: {
        Row: {
          active: boolean
          created_at: string
          dimension: string
          effective_from: string
          id: string
          note: string | null
          weight: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          dimension: string
          effective_from?: string
          id?: string
          note?: string | null
          weight: number
        }
        Update: {
          active?: boolean
          created_at?: string
          dimension?: string
          effective_from?: string
          id?: string
          note?: string | null
          weight?: number
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          scope: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          scope?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          scope?: string
        }
        Relationships: []
      }
      submission_sessions: {
        Row: {
          application_id: string
          completed_at: string | null
          error_log: string | null
          extension_session_id: string | null
          id: string
          portal_url: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          application_id: string
          completed_at?: string | null
          error_log?: string | null
          extension_session_id?: string | null
          id?: string
          portal_url?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          application_id?: string
          completed_at?: string | null
          error_log?: string | null
          extension_session_id?: string | null
          id?: string
          portal_url?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "submission_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "submission_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      subscription_credits: {
        Row: {
          consumed: number
          created_at: string
          granted: number
          id: string
          period_end: string
          period_start: string
          stripe_usage_record_id: string | null
          subscription_id: string
          user_id: string
        }
        Insert: {
          consumed?: number
          created_at?: string
          granted?: number
          id?: string
          period_end: string
          period_start: string
          stripe_usage_record_id?: string | null
          subscription_id: string
          user_id: string
        }
        Update: {
          consumed?: number
          created_at?: string
          granted?: number
          id?: string
          period_end?: string
          period_start?: string
          stripe_usage_record_id?: string | null
          subscription_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_credits_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_credits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_interval: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      template_revisions: {
        Row: {
          byte_size: number | null
          change_kind: string
          code: string
          country_code: string
          created_at: string
          id: string
          name: string
          new_field_count: number | null
          new_sha256: string
          new_version_label: string | null
          previous_field_count: number | null
          previous_sha256: string | null
          previous_version_label: string | null
          program: string
          resolved_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          storage_path: string | null
        }
        Insert: {
          byte_size?: number | null
          change_kind: string
          code: string
          country_code: string
          created_at?: string
          id?: string
          name?: string
          new_field_count?: number | null
          new_sha256: string
          new_version_label?: string | null
          previous_field_count?: number | null
          previous_sha256?: string | null
          previous_version_label?: string | null
          program: string
          resolved_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source: string
          storage_path?: string | null
        }
        Update: {
          byte_size?: number | null
          change_kind?: string
          code?: string
          country_code?: string
          created_at?: string
          id?: string
          name?: string
          new_field_count?: number | null
          new_sha256?: string
          new_version_label?: string | null
          previous_field_count?: number | null
          previous_sha256?: string | null
          previous_version_label?: string | null
          program?: string
          resolved_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      template_sweep_findings: {
        Row: {
          authority: string
          code: string
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          authority: string
          code: string
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title?: string
          updated_at?: string
          url: string
        }
        Update: {
          authority?: string
          code?: string
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          first_name: string | null
          last_name: string | null
          phone: string | null
          postal_code: string | null
          privacy: Json
          region: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          postal_code?: string | null
          privacy?: Json
          region?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          first_name?: string | null
          last_name?: string | null
          phone?: string | null
          postal_code?: string | null
          privacy?: Json
          region?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          organization_id: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          organization_id?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          organization_id?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          email_reminders: boolean
          full_name: string | null
          id: string
          nationality: string | null
          onboarded_at: string | null
          preferred_language: string | null
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          status_reason: string | null
          stripe_customer_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_reminders?: boolean
          full_name?: string | null
          id: string
          nationality?: string | null
          onboarded_at?: string | null
          preferred_language?: string | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          stripe_customer_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          email_reminders?: boolean
          full_name?: string | null
          id?: string
          nationality?: string | null
          onboarded_at?: string | null
          preferred_language?: string | null
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          stripe_customer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_countries: {
        Row: {
          code: string
          created_at: string
          data_quality: string
          evisa_portal_url: string | null
          fee_currency: string | null
          foreign_affairs_authority: string | null
          foreign_affairs_authority_url: string | null
          id: string
          immigration_authority: string | null
          immigration_authority_url: string | null
          is_bloc: boolean
          jurisdiction_note: string | null
          last_verified_at: string | null
          localized_names: Json
          name: string
          official_languages: string[]
          official_visa_url: string | null
          slug: string
          support_state: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          data_quality?: string
          evisa_portal_url?: string | null
          fee_currency?: string | null
          foreign_affairs_authority?: string | null
          foreign_affairs_authority_url?: string | null
          id?: string
          immigration_authority?: string | null
          immigration_authority_url?: string | null
          is_bloc?: boolean
          jurisdiction_note?: string | null
          last_verified_at?: string | null
          localized_names?: Json
          name: string
          official_languages?: string[]
          official_visa_url?: string | null
          slug: string
          support_state?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          data_quality?: string
          evisa_portal_url?: string | null
          fee_currency?: string | null
          foreign_affairs_authority?: string | null
          foreign_affairs_authority_url?: string | null
          id?: string
          immigration_authority?: string | null
          immigration_authority_url?: string | null
          is_bloc?: boolean
          jurisdiction_note?: string | null
          last_verified_at?: string | null
          localized_names?: Json
          name?: string
          official_languages?: string[]
          official_visa_url?: string | null
          slug?: string
          support_state?: string
          updated_at?: string
        }
        Relationships: []
      }
      visa_requirements: {
        Row: {
          confidence: number | null
          created_at: string
          description: string | null
          display_order: number
          extraction_method: string
          id: string
          kind: string
          label: string
          last_verified_at: string | null
          official_form_code: string | null
          official_form_url: string | null
          officially_required: boolean
          parameters: Json
          requirement_code: string
          rule: Json | null
          source_excerpt: string | null
          source_version_id: string
          status: string
          updated_at: string
          visa_type_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          display_order?: number
          extraction_method?: string
          id?: string
          kind: string
          label: string
          last_verified_at?: string | null
          official_form_code?: string | null
          official_form_url?: string | null
          officially_required?: boolean
          parameters?: Json
          requirement_code: string
          rule?: Json | null
          source_excerpt?: string | null
          source_version_id: string
          status?: string
          updated_at?: string
          visa_type_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          display_order?: number
          extraction_method?: string
          id?: string
          kind?: string
          label?: string
          last_verified_at?: string | null
          official_form_code?: string | null
          official_form_url?: string | null
          officially_required?: boolean
          parameters?: Json
          requirement_code?: string
          rule?: Json | null
          source_excerpt?: string | null
          source_version_id?: string
          status?: string
          updated_at?: string
          visa_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visa_requirements_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "visa_source_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_requirements_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_publishable_pages"
            referencedColumns: ["visa_type_id"]
          },
          {
            foreignKeyName: "visa_requirements_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_types"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_source_changes: {
        Row: {
          classification: string
          created_at: string
          diff: Json | null
          escalation_reasons: string[]
          from_version_id: string | null
          id: string
          requires_review: boolean
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          source_id: string
          state: string
          summary: string | null
          to_version_id: string
          updated_at: string
        }
        Insert: {
          classification?: string
          created_at?: string
          diff?: Json | null
          escalation_reasons?: string[]
          from_version_id?: string | null
          id?: string
          requires_review?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          source_id: string
          state?: string
          summary?: string | null
          to_version_id: string
          updated_at?: string
        }
        Update: {
          classification?: string
          created_at?: string
          diff?: Json | null
          escalation_reasons?: string[]
          from_version_id?: string | null
          id?: string
          requires_review?: boolean
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          source_id?: string
          state?: string
          summary?: string | null
          to_version_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visa_source_changes_from_version_id_fkey"
            columns: ["from_version_id"]
            isOneToOne: false
            referencedRelation: "visa_source_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_source_changes_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "visa_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_source_changes_to_version_id_fkey"
            columns: ["to_version_id"]
            isOneToOne: false
            referencedRelation: "visa_source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_source_checks: {
        Row: {
          checked_at: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          redirect_url: string | null
          run_id: string
          source_id: string
          status: string
          version_id: string | null
        }
        Insert: {
          checked_at?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          redirect_url?: string | null
          run_id: string
          source_id: string
          status: string
          version_id?: string | null
        }
        Update: {
          checked_at?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          redirect_url?: string | null
          run_id?: string
          source_id?: string
          status?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visa_source_checks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "visa_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_source_checks_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "visa_source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_source_versions: {
        Row: {
          byte_size: number | null
          content_type: string | null
          created_at: string
          effective_from: string | null
          extractor_version: string
          fetched_at: string
          http_status: number | null
          id: string
          is_active: boolean
          normalized_sha256: string
          published_at: string | null
          raw_sha256: string
          source_id: string
          storage_path: string | null
          superseded_by: string | null
          version_number: number
        }
        Insert: {
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          effective_from?: string | null
          extractor_version?: string
          fetched_at?: string
          http_status?: number | null
          id?: string
          is_active?: boolean
          normalized_sha256: string
          published_at?: string | null
          raw_sha256: string
          source_id: string
          storage_path?: string | null
          superseded_by?: string | null
          version_number: number
        }
        Update: {
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          effective_from?: string | null
          extractor_version?: string
          fetched_at?: string
          http_status?: number | null
          id?: string
          is_active?: boolean
          normalized_sha256?: string
          published_at?: string | null
          raw_sha256?: string
          source_id?: string
          storage_path?: string | null
          superseded_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "visa_source_versions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "visa_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_source_versions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "visa_source_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_sources: {
        Row: {
          active: boolean
          authority: string
          authority_rank: number
          canonical_url: string
          check_interval: string
          country_id: string
          created_at: string
          failure_streak: number
          first_seen_at: string
          freshness_sla: string
          id: string
          language: string
          last_changed_at: string | null
          last_checked_at: string | null
          last_success_at: string | null
          redistribution: string
          robots_state: string
          role: string
          source_url: string
          title: string | null
          updated_at: string
          visa_type_id: string | null
        }
        Insert: {
          active?: boolean
          authority: string
          authority_rank?: number
          canonical_url: string
          check_interval?: string
          country_id: string
          created_at?: string
          failure_streak?: number
          first_seen_at?: string
          freshness_sla?: string
          id?: string
          language?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_success_at?: string | null
          redistribution?: string
          robots_state?: string
          role: string
          source_url: string
          title?: string | null
          updated_at?: string
          visa_type_id?: string | null
        }
        Update: {
          active?: boolean
          authority?: string
          authority_rank?: number
          canonical_url?: string
          check_interval?: string
          country_id?: string
          created_at?: string
          failure_streak?: number
          first_seen_at?: string
          freshness_sla?: string
          id?: string
          language?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_success_at?: string | null
          redistribution?: string
          robots_state?: string
          role?: string
          source_url?: string
          title?: string | null
          updated_at?: string
          visa_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visa_sources_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "visa_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_sources_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_publishable_pages"
            referencedColumns: ["visa_type_id"]
          },
          {
            foreignKeyName: "visa_sources_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_types"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_sync_runs: {
        Row: {
          blocked_count: number
          changed_count: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          ok_count: number
          parse_error_count: number
          sources_checked: number
          started_at: string
          status: string
          trigger: string
          unavailable_count: number
        }
        Insert: {
          blocked_count?: number
          changed_count?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          ok_count?: number
          parse_error_count?: number
          sources_checked?: number
          started_at?: string
          status?: string
          trigger?: string
          unavailable_count?: number
        }
        Update: {
          blocked_count?: number
          changed_count?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          ok_count?: number
          parse_error_count?: number
          sources_checked?: number
          started_at?: string
          status?: string
          trigger?: string
          unavailable_count?: number
        }
        Relationships: []
      }
      visa_types: {
        Row: {
          aliases: string[]
          category: string
          country_id: string
          created_at: string
          data_quality: string
          effective_from: string | null
          effective_to: string | null
          id: string
          last_verified_at: string | null
          lifecycle_state: string
          official_code: string | null
          official_description: string | null
          official_name: string
          official_stream: string | null
          program_id: string | null
          purpose: string | null
          slug: string
          updated_at: string
          visaai_id: string
        }
        Insert: {
          aliases?: string[]
          category: string
          country_id: string
          created_at?: string
          data_quality?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          last_verified_at?: string | null
          lifecycle_state?: string
          official_code?: string | null
          official_description?: string | null
          official_name: string
          official_stream?: string | null
          program_id?: string | null
          purpose?: string | null
          slug: string
          updated_at?: string
          visaai_id: string
        }
        Update: {
          aliases?: string[]
          category?: string
          country_id?: string
          created_at?: string
          data_quality?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          last_verified_at?: string | null
          lifecycle_state?: string
          official_code?: string | null
          official_description?: string | null
          official_name?: string
          official_stream?: string | null
          program_id?: string | null
          purpose?: string | null
          slug?: string
          updated_at?: string
          visaai_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visa_types_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "visa_countries"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_consents: {
        Row: {
          created_at: string
          granted: boolean
          granted_at: string | null
          id: string
          kind: string
          policy_version: string
          revoked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          granted_at?: string | null
          id?: string
          kind: string
          policy_version: string
          revoked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          granted_at?: string | null
          id?: string
          kind?: string
          policy_version?: string
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_messages: {
        Row: {
          conversation_id: string
          created_at: string
          duration_ms: number
          id: string
          message_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          duration_ms?: number
          id?: string
          message_id: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          duration_ms?: number
          id?: string
          message_id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_sessions: {
        Row: {
          application_id: string | null
          audio_ms: number
          cost_usd: number
          end_reason: string | null
          ended_at: string | null
          escalated_to_consultation_id: string | null
          id: string
          language: string
          last_activity_at: string
          started_at: string
          status: string
          tokens_used: number
          turn_count: number
          user_id: string
        }
        Insert: {
          application_id?: string | null
          audio_ms?: number
          cost_usd?: number
          end_reason?: string | null
          ended_at?: string | null
          escalated_to_consultation_id?: string | null
          id?: string
          language?: string
          last_activity_at?: string
          started_at?: string
          status?: string
          tokens_used?: number
          turn_count?: number
          user_id: string
        }
        Update: {
          application_id?: string | null
          audio_ms?: number
          cost_usd?: number
          end_reason?: string | null
          ended_at?: string | null
          escalated_to_consultation_id?: string | null
          id?: string
          language?: string
          last_activity_at?: string
          started_at?: string
          status?: string
          tokens_used?: number
          turn_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "voice_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "voice_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_sessions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "voice_sessions_escalated_to_consultation_id_fkey"
            columns: ["escalated_to_consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_transcript_turns: {
        Row: {
          audio_ms: number | null
          confidence: number | null
          created_at: string
          id: string
          language: string | null
          redacted_text: string | null
          role: string
          safety_flags: string[]
          session_id: string
          text: string
          user_id: string
        }
        Insert: {
          audio_ms?: number | null
          confidence?: number | null
          created_at?: string
          id?: string
          language?: string | null
          redacted_text?: string | null
          role: string
          safety_flags?: string[]
          session_id: string
          text: string
          user_id: string
        }
        Update: {
          audio_ms?: number | null
          confidence?: number | null
          created_at?: string
          id?: string
          language?: string | null
          redacted_text?: string | null
          role?: string
          safety_flags?: string[]
          session_id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_transcript_turns_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "voice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_transcript_turns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vri_recommendations: {
        Row: {
          factor: string
          id: string
          issue: string
          priority: number
          recommendation_text: string
          vri_score_id: string
        }
        Insert: {
          factor: string
          id?: string
          issue: string
          priority?: number
          recommendation_text: string
          vri_score_id: string
        }
        Update: {
          factor?: string
          id?: string
          issue?: string
          priority?: number
          recommendation_text?: string
          vri_score_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vri_recommendations_vri_score_id_fkey"
            columns: ["vri_score_id"]
            isOneToOne: false
            referencedRelation: "vri_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      vri_scores: {
        Row: {
          application_id: string
          calculated_at: string
          consistency_pct: number
          documentation_pct: number
          employment_pct: number
          escalated: boolean
          escalation_reason: string | null
          financial_pct: number
          home_ties_pct: number
          id: string
          overall_score: number
          travel_history_pct: number
          unassessed_factors: string[] | null
        }
        Insert: {
          application_id: string
          calculated_at?: string
          consistency_pct?: number
          documentation_pct?: number
          employment_pct?: number
          escalated?: boolean
          escalation_reason?: string | null
          financial_pct?: number
          home_ties_pct?: number
          id?: string
          overall_score: number
          travel_history_pct?: number
          unassessed_factors?: string[] | null
        }
        Update: {
          application_id?: string
          calculated_at?: string
          consistency_pct?: number
          documentation_pct?: number
          employment_pct?: number
          escalated?: boolean
          escalation_reason?: string | null
          financial_pct?: number
          home_ties_pct?: number
          id?: string
          overall_score?: number
          travel_history_pct?: number
          unassessed_factors?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "vri_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "vri_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "vri_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vri_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      vri_visa_suggestions: {
        Row: {
          approval_likelihood: number
          country_code: string
          id: string
          official_source: string | null
          rank: number
          reasoning: string
          required_documents: Json
          required_forms: Json
          visa_category: string
          vri_score_id: string
        }
        Insert: {
          approval_likelihood: number
          country_code: string
          id?: string
          official_source?: string | null
          rank?: number
          reasoning: string
          required_documents?: Json
          required_forms?: Json
          visa_category: string
          vri_score_id: string
        }
        Update: {
          approval_likelihood?: number
          country_code?: string
          id?: string
          official_source?: string | null
          rank?: number
          reasoning?: string
          required_documents?: Json
          required_forms?: Json
          visa_category?: string
          vri_score_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vri_visa_suggestions_vri_score_id_fkey"
            columns: ["vri_score_id"]
            isOneToOne: false
            referencedRelation: "vri_scores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ai_cost_actual_vs_model: {
        Row: {
          ai_cost_actual: number | null
          ai_cost_model: number | null
          application_id: string | null
          country_code: string | null
          drift_usd: number | null
          visa_type: string | null
        }
        Relationships: []
      }
      ai_cost_per_application: {
        Row: {
          ai_cost_actual: number | null
          application_id: string | null
          billable_cost_actual: number | null
          call_count: number | null
          input_tokens: number | null
          last_event_at: string | null
          output_tokens: number | null
          units: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      application_activity: {
        Row: {
          application_id: string | null
          last_active_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      section_verification: {
        Row: {
          application_id: string | null
          field_count: number | null
          ready_count: number | null
          section: string | null
          section_state:
            | Database["public"]["Enums"]["verification_state"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_actual_vs_model"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "application_activity"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_funnel"
            referencedColumns: ["application_id"]
          },
        ]
      }
      v_application_funnel: {
        Row: {
          application_id: string | null
          created_at: string | null
          reached_readiness: boolean | null
          readiness_reached_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          application_id?: string | null
          created_at?: string | null
          reached_readiness?: never
          readiness_reached_at?: never
          status?: string | null
          user_id?: string | null
        }
        Update: {
          application_id?: string | null
          created_at?: string | null
          reached_readiness?: never
          readiness_reached_at?: never
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_dml_grants_without_policy: {
        Row: {
          table_name: unknown
        }
        Relationships: []
      }
      v_public_indexes: {
        Row: {
          indexname: unknown
          schemaname: unknown
          tablename: unknown
        }
        Relationships: []
      }
      visa_publishable_pages: {
        Row: {
          category: string | null
          country_code: string | null
          country_name: string | null
          country_slug: string | null
          last_verified_at: string | null
          official_name: string | null
          official_requirement_count: number | null
          source_count: number | null
          visa_slug: string | null
          visa_type_id: string | null
          visaai_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      app_destination_country: { Args: { p_app: string }; Returns: string }
      app_has_active_consultant: { Args: { p_app: string }; Returns: boolean }
      audit_verify_chain: {
        Args: { p_application_id: string }
        Returns: {
          broken_at_seq: number
          reason: string
        }[]
      }
      bump_delivery_attempt: {
        Args: { p_delivery_id: string; p_error?: string; p_status: string }
        Returns: undefined
      }
      claim_outbox_batch: {
        Args: { p_limit: number }
        Returns: {
          attempts: number
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_stale_anonymous_users: {
        Args: { p_age?: string }
        Returns: number
      }
      consultant_covers_country: {
        Args: { p_country: string; p_uid: string }
        Returns: boolean
      }
      consume_review_credit: {
        Args: { p_application_id: string; p_user_id: string }
        Returns: boolean
      }
      ensure_month_partition: { Args: { p_month: string }; Returns: undefined }
      field_provenance_create_version: {
        Args: {
          p_application_id: string
          p_confidence: number
          p_confidence_band: string
          p_field_key: string
          p_ocr_run_id: string
          p_origin: string
          p_source_bbox: Json
          p_source_document_id: string
          p_source_page: number
          p_value_hash: string
          p_value_snapshot: string
        }
        Returns: {
          application_id: string
          confidence: number | null
          confidence_band: string | null
          created_at: string
          extraction_timestamp: string
          field_key: string
          id: string
          ocr_run_id: string | null
          origin: string
          source_bbox: Json | null
          source_document_id: string | null
          source_page: number | null
          superseded_by: string | null
          value_hash: string | null
          value_snapshot: string | null
        }
        SetofOptions: {
          from: "*"
          to: "field_provenance"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      increment_partner_usage: {
        Args: {
          p_application_id: string
          p_delta?: number
          p_window_kind: string
          p_window_start: string
        }
        Returns: number
      }
      is_active_assignee: {
        Args: { p_app: string; p_uid: string }
        Returns: boolean
      }
      is_analytics_admin: { Args: never; Returns: boolean }
      is_marketplace_admin: { Args: never; Returns: boolean }
      is_pricing_admin: { Args: never; Returns: boolean }
      is_risk_admin: { Args: never; Returns: boolean }
      is_schengen_member: { Args: { p_code: string }; Returns: boolean }
      redeem_coupon: { Args: { p_coupon_id: string }; Returns: boolean }
      sec_application_owner: { Args: { p_app: string }; Returns: string }
      sec_is_privileged_writer: { Args: never; Returns: boolean }
    }
    Enums: {
      audit_actor_role: "system" | "applicant" | "consultant" | "admin"
      audit_event_type:
        | "DOCUMENT_UPLOADED"
        | "OCR_COMPLETED"
        | "FIELD_EXTRACTED"
        | "FIELD_EDITED"
        | "USER_CONFIRMED"
        | "CONSULTANT_REVIEWED"
        | "CONSULTANT_APPROVED"
        | "PREFLIGHT_STARTED"
        | "PREFLIGHT_COMPLETED"
        | "EXECUTION_STARTED"
        | "EXECUTION_COMPLETED"
        | "EXECUTION_FAILED"
        | "EXECUTION_READY"
        | "READBACK_CONFIRMED"
        | "EXECUTION_REQUESTED"
        | "LEGACY_AUTOMATION_BLOCKED"
        | "PORTAL_FILL_STARTED"
        | "FIELD_WRITE_ATTEMPT"
        | "READBACK_COMPARE"
        | "FIELD_VERIFIED"
        | "PORTAL_FILL_COMPLETED"
        | "CONSULTANT_SELF_ASSIGNED"
        | "CONSULTANT_ASSIGNED"
        | "CONSULTANT_REASSIGNED"
        | "CONSULTANT_UNASSIGNED"
        | "CONSULTANT_COMPLETED"
        | "CONSULTANT_DEADLINE_CHANGED"
        | "CONSULTANT_ASSIGNMENT_EXPIRED"
        | "CONSULTANT_ESCALATION_FLAGGED"
      consultant_decision: "reviewed" | "approved" | "rejected" | "revoked"
      preflight_status: "in_review" | "completed" | "invalidated"
      verification_state:
        | "EXTRACTED"
        | "USER_CONFIRMED"
        | "CONSULTANT_REVIEWED"
        | "CONSULTANT_APPROVED"
        | "EXECUTION_READY"
        | "EXECUTED"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      audit_actor_role: ["system", "applicant", "consultant", "admin"],
      audit_event_type: [
        "DOCUMENT_UPLOADED",
        "OCR_COMPLETED",
        "FIELD_EXTRACTED",
        "FIELD_EDITED",
        "USER_CONFIRMED",
        "CONSULTANT_REVIEWED",
        "CONSULTANT_APPROVED",
        "PREFLIGHT_STARTED",
        "PREFLIGHT_COMPLETED",
        "EXECUTION_STARTED",
        "EXECUTION_COMPLETED",
        "EXECUTION_FAILED",
        "EXECUTION_READY",
        "READBACK_CONFIRMED",
        "EXECUTION_REQUESTED",
        "LEGACY_AUTOMATION_BLOCKED",
        "PORTAL_FILL_STARTED",
        "FIELD_WRITE_ATTEMPT",
        "READBACK_COMPARE",
        "FIELD_VERIFIED",
        "PORTAL_FILL_COMPLETED",
        "CONSULTANT_SELF_ASSIGNED",
        "CONSULTANT_ASSIGNED",
        "CONSULTANT_REASSIGNED",
        "CONSULTANT_UNASSIGNED",
        "CONSULTANT_COMPLETED",
        "CONSULTANT_DEADLINE_CHANGED",
        "CONSULTANT_ASSIGNMENT_EXPIRED",
        "CONSULTANT_ESCALATION_FLAGGED",
      ],
      consultant_decision: ["reviewed", "approved", "rejected", "revoked"],
      preflight_status: ["in_review", "completed", "invalidated"],
      verification_state: [
        "EXTRACTED",
        "USER_CONFIRMED",
        "CONSULTANT_REVIEWED",
        "CONSULTANT_APPROVED",
        "EXECUTION_READY",
        "EXECUTED",
      ],
    },
  },
} as const

