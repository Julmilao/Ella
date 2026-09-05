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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      solicitacoes_os: {
        Row: {
          id: string
          config_id: string | null
          envio_id: string | null
          usuario_id: string | null
          executante: string
          cliente_id: string
          data_os: string
          hora_inicio: string
          hora_fim: string
          ticket: string | null
          tarefa: string
          horas_executadas: number
          status_os: string
          status_abertura: string
          observacoes: string | null
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          config_id?: string | null
          envio_id?: string | null
          usuario_id?: string | null
          executante: string
          cliente_id: string
          data_os: string
          hora_inicio: string
          hora_fim: string
          ticket?: string | null
          tarefa: string
          horas_executadas: number
          status_os?: string
          status_abertura?: string
          observacoes?: string | null
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: string
          config_id?: string | null
          envio_id?: string | null
          usuario_id?: string | null
          executante?: string
          cliente_id?: string
          data_os?: string
          hora_inicio?: string
          hora_fim?: string
          ticket?: string | null
          tarefa?: string
          horas_executadas?: number
          status_os?: string
          status_abertura?: string
          observacoes?: string | null
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: []
      }
      modelos_rotina: {
        Row: {
          id: number
          nome: string
          tipo: string
          periodo: string
          periodo_referencia: string
          dia_envio: number
          scheduler_hora: string
          horarios_dia: Json
          tipo_agendamento: string
          intervalo_minutos: number | null
          enviar_sem_os: boolean
          is_padrao: boolean
          ativo: boolean
          criado_em: string
        }
        Insert: {
          id?: number
          nome: string
          tipo?: string
          periodo?: string
          periodo_referencia?: string
          dia_envio?: number
          scheduler_hora?: string
          horarios_dia?: Json
          tipo_agendamento?: string
          intervalo_minutos?: number | null
          enviar_sem_os?: boolean
          is_padrao?: boolean
          ativo?: boolean
          criado_em?: string
        }
        Update: {
          id?: number
          nome?: string
          tipo?: string
          periodo?: string
          periodo_referencia?: string
          dia_envio?: number
          scheduler_hora?: string
          horarios_dia?: Json
          tipo_agendamento?: string
          intervalo_minutos?: number | null
          enviar_sem_os?: boolean
          is_padrao?: boolean
          ativo?: boolean
          criado_em?: string
        }
        Relationships: []
      }
      clientes: {
        Row: {
          id: string
          nome: string
          cnpj: string | null
          ativo: boolean
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          nome: string
          cnpj?: string | null
          ativo?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: string
          nome?: string
          cnpj?: string | null
          ativo?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: []
      }
      configuracoes_clientes: {
        Row: {
          id: string
          cliente_id: string
          exp_usuario: string | null
          exp_senha: string | null
          url_abertura_os: string | null
          url_saldo_horas: string | null
          obs: string | null
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          cliente_id: string
          exp_usuario?: string | null
          exp_senha?: string | null
          url_abertura_os?: string | null
          url_saldo_horas?: string | null
          obs?: string | null
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: string
          cliente_id?: string
          exp_usuario?: string | null
          exp_senha?: string | null
          url_abertura_os?: string | null
          url_saldo_horas?: string | null
          obs?: string | null
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: true
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          }
        ]
      }
      logs: {
        Row: {
          id: string
          modulo: string
          execucao_id: string | null
          tipo: string
          mensagem: string
          detalhe: string | null
          usuario_id: string | null
          criado_em: string
        }
        Insert: {
          id?: string
          modulo: string
          execucao_id?: string | null
          tipo: string
          mensagem: string
          detalhe?: string | null
          usuario_id?: string | null
          criado_em?: string
        }
        Update: {
          id?: string
          modulo?: string
          execucao_id?: string | null
          tipo?: string
          mensagem?: string
          detalhe?: string | null
          usuario_id?: string | null
          criado_em?: string
        }
        Relationships: []
      }
      configuracoes_gerais: {
        Row: {
          created_at: string
          exp_senha: string | null
          exp_url: string | null
          exp_usuario: string | null
          id: number
          pdf_cabecalho: string | null
          pdf_nome_empresa: string | null
          pdf_rodape: string | null
          smtp_de_nome: string | null
          smtp_host: string | null
          smtp_porta: number | null
          smtp_senha: string | null
          smtp_usar_tls: boolean | null
          smtp_tipo_conexao: string | null
          smtp_ignorar_cert: boolean | null
          smtp_usuario: string | null
          tenant_id: number | null
          scheduler_hora: string | null
          scheduler_intervalo_minutos: number | null
          rpa_headless: boolean | null
          rpa_timeout_ms: number | null
          rpa_tentativas: number | null
          rpa_delay_entre_os_ms: number | null
          rotina_os_id: number | null
          ultimo_disparo_os_ts: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          exp_senha?: string | null
          exp_url?: string | null
          exp_usuario?: string | null
          id?: number
          pdf_cabecalho?: string | null
          pdf_nome_empresa?: string | null
          pdf_rodape?: string | null
          smtp_de_nome?: string | null
          smtp_host?: string | null
          smtp_porta?: number | null
          smtp_senha?: string | null
          smtp_usar_tls?: boolean | null
          smtp_tipo_conexao?: string | null
          smtp_ignorar_cert?: boolean | null
          smtp_usuario?: string | null
          tenant_id?: number | null
          scheduler_hora?: string | null
          scheduler_intervalo_minutos?: number | null
          rpa_headless?: boolean | null
          rpa_timeout_ms?: number | null
          rpa_tentativas?: number | null
          rpa_delay_entre_os_ms?: number | null
          rotina_os_id?: number | null
          ultimo_disparo_os_ts?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          exp_senha?: string | null
          exp_url?: string | null
          exp_usuario?: string | null
          id?: number
          pdf_cabecalho?: string | null
          pdf_nome_empresa?: string | null
          pdf_rodape?: string | null
          smtp_de_nome?: string | null
          smtp_host?: string | null
          smtp_porta?: number | null
          smtp_senha?: string | null
          smtp_usar_tls?: boolean | null
          smtp_tipo_conexao?: string | null
          smtp_ignorar_cert?: boolean | null
          smtp_usuario?: string | null
          tenant_id?: number | null
          scheduler_hora?: string | null
          scheduler_intervalo_minutos?: number | null
          rpa_headless?: boolean | null
          rpa_timeout_ms?: number | null
          rpa_tentativas?: number | null
          rpa_delay_entre_os_ms?: number | null
          rotina_os_id?: number | null
          ultimo_disparo_os_ts?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          nome: string | null
          role: "admin" | "user"
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
          role?: "admin" | "user"
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
          role?: "admin" | "user"
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      modelos_email: {
        Row: {
          id: number
          assunto: string
          corpo: string
          ativo: boolean
          is_padrao: boolean
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: number
          assunto: string
          corpo: string
          ativo?: boolean
          is_padrao?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: number
          assunto?: string
          corpo?: string
          ativo?: boolean
          is_padrao?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: []
      }
      status_report_configs: {
        Row: {
          id: string
          cliente_id: string
          modelo_id: number | null
          modelo_rotina_id: number | null
          fap: string | null
          periodo: string | null
          dia_envio: number
          enviar_sem_os: boolean
          ativo: boolean
          modo_teste: boolean
          email_teste: string | null
          intervalo_minutos: number | null
          ultimo_envio_ts: string | null
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          cliente_id: string
          modelo_id?: number | null
          modelo_rotina_id?: number | null
          fap?: string | null
          periodo?: string | null
          dia_envio: number
          enviar_sem_os?: boolean
          ativo?: boolean
          modo_teste?: boolean
          email_teste?: string | null
          intervalo_minutos?: number | null
          ultimo_envio_ts?: string | null
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: string
          cliente_id?: string
          modelo_id?: number | null
          modelo_rotina_id?: number | null
          fap?: string | null
          periodo?: string | null
          dia_envio?: number
          enviar_sem_os?: boolean
          ativo?: boolean
          modo_teste?: boolean
          email_teste?: string | null
          intervalo_minutos?: number | null
          ultimo_envio_ts?: string | null
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_report_configs_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_report_configs_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos_email"
            referencedColumns: ["id"]
          }
        ]
      }
      sr_destinatarios: {
        Row: {
          id: string
          config_id: string
          email: string
          ativo: boolean
        }
        Insert: {
          id?: string
          config_id: string
          email: string
          ativo?: boolean
        }
        Update: {
          id?: string
          config_id?: string
          email?: string
          ativo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "sr_destinatarios_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "status_report_configs"
            referencedColumns: ["id"]
          }
        ]
      }
      sr_envios: {
        Row: {
          id: string
          config_id: string
          status: "enviado" | "erro" | "pendente"
          enviado_em: string
          periodo_inicio: string
          periodo_fim: string
          erro_msg: string | null
          pdf_path: string | null
        }
        Insert: {
          id?: string
          config_id: string
          status?: "enviado" | "erro" | "pendente"
          enviado_em?: string
          periodo_inicio: string
          periodo_fim: string
          erro_msg?: string | null
          pdf_path?: string | null
        }
        Update: {
          id?: string
          config_id?: string
          status?: "enviado" | "erro" | "pendente"
          enviado_em?: string
          periodo_inicio?: string
          periodo_fim?: string
          erro_msg?: string | null
          pdf_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sr_envios_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "status_report_configs"
            referencedColumns: ["id"]
          }
        ]
      }
      sr_envio_destinatarios: {
        Row: {
          id: string
          envio_id: string
          email: string
          status_entrega: "entregue" | "pendente" | "erro"
        }
        Insert: {
          id?: string
          envio_id: string
          email: string
          status_entrega?: "entregue" | "pendente" | "erro"
        }
        Update: {
          id?: string
          envio_id?: string
          email?: string
          status_entrega?: "entregue" | "pendente" | "erro"
        }
        Relationships: [
          {
            foreignKeyName: "sr_envio_destinatarios_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "sr_envios"
            referencedColumns: ["id"]
          }
        ]
      }
      user_module_access: {
        Row: {
          created_at: string
          has_access: boolean
          id: string
          module_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          has_access?: boolean
          id?: string
          module_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          has_access?: boolean
          id?: string
          module_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
