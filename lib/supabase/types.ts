// Hand-written to match supabase/schema.sql. Regenerate with the Supabase
// CLI (`supabase gen types typescript`) once the project is live if the
// schema drifts.

export type UserRole = "citizen" | "officer" | "admin";

export type IssueStatus =
  | "reported"
  | "acknowledged"
  | "in_progress"
  | "resolved"
  | "rejected";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: UserRole;
          department_id: string | null;
          points: number;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: UserRole;
          department_id?: string | null;
          points?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          }
        ];
      };
      departments: {
        Row: {
          id: string;
          name: string;
          category_keys: string[];
        };
        Insert: {
          id?: string;
          name: string;
          category_keys?: string[];
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Insert"]>;
        Relationships: [];
      };
      issues: {
        Row: {
          id: string;
          reporter_id: string;
          title: string;
          description: string | null;
          ai_category: string;
          ai_severity: number;
          ai_severity_label: string;
          ai_confidence: number;
          photo_url: string;
          lat: number;
          lng: number;
          address: string | null;
          status: IssueStatus;
          department_id: string | null;
          upvote_count: number;
          duplicate_of: string | null;
          resolution_photo_url: string | null;
          resolution_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          title: string;
          description?: string | null;
          ai_category: string;
          ai_severity: number;
          ai_severity_label: string;
          ai_confidence: number;
          photo_url: string;
          lat: number;
          lng: number;
          address?: string | null;
          status?: IssueStatus;
          department_id?: string | null;
          upvote_count?: number;
          duplicate_of?: string | null;
          resolution_photo_url?: string | null;
          resolution_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["issues"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "issues_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_duplicate_of_fkey";
            columns: ["duplicate_of"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          }
        ];
      };
      issue_upvotes: {
        Row: {
          issue_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          issue_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["issue_upvotes"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "issue_upvotes_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issue_upvotes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      issue_status_history: {
        Row: {
          id: string;
          issue_id: string;
          status: IssueStatus;
          note: string | null;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          issue_id: string;
          status: IssueStatus;
          note?: string | null;
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["issue_status_history"]["Insert"]
        >;
        Relationships: [
          {
            foreignKeyName: "issue_status_history_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issue_status_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      nearby_open_issues: {
        Args: {
          p_category: string;
          p_lng: number;
          p_lat: number;
          p_radius_m?: number;
        };
        Returns: Database["public"]["Tables"]["issues"]["Row"][];
      };
    };
  };
}
