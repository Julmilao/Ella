-- Campos de sustentação no cadastro de clientes
ALTER TABLE public.clientes
  ADD COLUMN sustentacao_desde DATE,
  ADD COLUMN status_sustentacao TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status_sustentacao IN ('ativo', 'inativo', 'suspenso'));
