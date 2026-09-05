-- Adiciona flag de tipo de atividade na solicitação de OS
ALTER TABLE public.solicitacoes_os
  ADD COLUMN is_ticket BOOLEAN NOT NULL DEFAULT false;
