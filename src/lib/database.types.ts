
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "families": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"invite_code": string,"invite_code_expires_at": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"invite_code": string,"invite_code_expires_at"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"invite_code"?: string,"invite_code_expires_at"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"family_members": {
                  Row: {
                    "family_id": string,"joined_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "family_id": string,"joined_at"?: string,"user_id": string
                  }
                  Update: {
                    "family_id"?: string,"joined_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "family_members_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "families"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "created_at": string,"created_by": string | null,"done_at": string | null,"family_id": string,"id": string,"is_done": boolean,"list_id": string,"name": string,"note": string | null,"sort_order": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"family_id": string,"id"?: string,"is_done"?: boolean,"list_id": string,"name": string,"note"?: string | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"done_at"?: string | null,"family_id"?: string,"id"?: string,"is_done"?: boolean,"list_id"?: string,"name"?: string,"note"?: string | null,"sort_order"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_list_id_family_id_fkey"
      columns: ["list_id","family_id"]
isOneToOne: false
      referencedRelation: "lists"
      referencedColumns: ["id","family_id"]
    }
                  ]
                },"join_attempts": {
                  Row: {
                    "attempted_at": string,"succeeded": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempted_at"?: string,"succeeded": boolean,"user_id": string
                  }
                  Update: {
                    "attempted_at"?: string,"succeeded"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"list_locations": {
                  Row: {
                    "address": string | null,"family_id": string,"id": string,"kakao_place_id": string | null,"lat": number,"list_id": string,"lng": number,"place_name": string,"radius_m": number
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"family_id": string,"id"?: string,"kakao_place_id"?: string | null,"lat": number,"list_id": string,"lng": number,"place_name": string,"radius_m"?: number
                  }
                  Update: {
                    "address"?: string | null,"family_id"?: string,"id"?: string,"kakao_place_id"?: string | null,"lat"?: number,"list_id"?: string,"lng"?: number,"place_name"?: string,"radius_m"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "list_locations_list_id_family_id_fkey"
      columns: ["list_id","family_id"]
isOneToOne: false
      referencedRelation: "lists"
      referencedColumns: ["id","family_id"]
    }
                  ]
                },"lists": {
                  Row: {
                    "created_at": string,"family_id": string,"id": string,"kind": Database["public"]['Enums']["list_kind"],"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"family_id": string,"id"?: string,"kind": Database["public"]['Enums']["list_kind"],"name": string,"sort_order"?: number
                  }
                  Update: {
                    "created_at"?: string,"family_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["list_kind"],"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "lists_family_id_fkey"
      columns: ["family_id"]
isOneToOne: false
      referencedRelation: "families"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"search_usage": {
                  Row: {
                    "used_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "used_at"?: string,"user_id": string
                  }
                  Update: {
                    "used_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "consume_search_quota":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"create_family":
{ Args: { "p_name": string }; Returns: string
                           },
"family_item_count":
{ Args: { "p_family_id": string }; Returns: number
                           },
"gen_invite_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"is_member":
{ Args: { "fid": string }; Returns: boolean
                           },
"join_family":
{ Args: { "p_code": string }; Returns: Json
                           },
"leave_family":
{ Args: { "p_family_id": string }; Returns: undefined
                           },
"regenerate_invite_code":
{ Args: { "p_family_id": string }; Returns: string
                           }
          }
          Enums: {
            "list_kind": "inbox"|"store"|"online"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "list_kind": ["inbox", "store", "online"]
          }
        }
} as const
