-- Histórico de horas mensais contratadas por cliente
-- Modelo "effective date": dado um mês, o contrato vigente é o de vigente_de mais recente <= primeiro dia do mês consultado
CREATE TABLE public.contratos_horas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  horas_mensais NUMERIC(10,2) NOT NULL CHECK (horas_mensais > 0),
  vigente_de    DATE NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por    UUID REFERENCES auth.users(id),
  observacao    TEXT,
  UNIQUE (cliente_id, vigente_de)
);

-- Índice para lookup histórico eficiente
CREATE INDEX idx_contratos_horas_lookup ON public.contratos_horas (cliente_id, vigente_de DESC);

ALTER TABLE public.contratos_horas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contratos_horas_all"
  ON public.contratos_horas FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
