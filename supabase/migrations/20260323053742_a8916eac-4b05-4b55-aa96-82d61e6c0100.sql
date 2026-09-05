
-- Configurações gerais do sistema (1 linha por tenant)
CREATE TABLE public.configuracoes_gerais (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER UNIQUE,
  exp_url VARCHAR(500),
  exp_usuario VARCHAR(255),
  exp_senha TEXT,
  smtp_host VARCHAR(255) DEFAULT 'smtp.gmail.com',
  smtp_porta SMALLINT DEFAULT 587,
  smtp_usuario VARCHAR(255),
  smtp_senha TEXT,
  smtp_de_nome VARCHAR(100) DEFAULT 'ServicePro',
  smtp_usar_tls BOOLEAN DEFAULT TRUE,
  pdf_nome_empresa VARCHAR(255),
  pdf_cabecalho VARCHAR(500) DEFAULT 'Relatório de Status',
  pdf_rodape VARCHAR(500) DEFAULT 'Gerado pelo ServicePro',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.configuracoes_gerais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view configuracoes"
  ON public.configuracoes_gerais FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert configuracoes"
  ON public.configuracoes_gerais FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update configuracoes"
  ON public.configuracoes_gerais FOR UPDATE TO authenticated
  USING (true);

-- Controle de acesso dos usuários aos módulos
CREATE TABLE public.user_module_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  module_key TEXT NOT NULL,
  has_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, module_key)
);

ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view module access"
  ON public.user_module_access FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert module access"
  ON public.user_module_access FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update module access"
  ON public.user_module_access FOR UPDATE TO authenticated
  USING (true);

-- Trigger updated_at for configuracoes_gerais
CREATE TRIGGER update_configuracoes_gerais_updated_at
  BEFORE UPDATE ON public.configuracoes_gerais
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger updated_at for user_module_access
CREATE TRIGGER update_user_module_access_updated_at
  BEFORE UPDATE ON public.user_module_access
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
