-- Substitui flag booleana por campo de tipo estruturado
ALTER TABLE public.solicitacoes_os
  DROP COLUMN IF EXISTS is_ticket,
  ADD COLUMN tipo_atividade TEXT NOT NULL DEFAULT 'os'
    CHECK (tipo_atividade IN ('os', 'ticket', 'pipefy', 'outro'));
