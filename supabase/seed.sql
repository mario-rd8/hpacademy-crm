-- =============================================================================
-- HP Academy CRM — Seed Inicial (BD-Perfect)
-- =============================================================================

-- 1. Colunas iniciais do Kanban
INSERT INTO crm.stages (name, slug, position, color, is_system) VALUES
  ('Contato novo',  'contato-novo',  0, '#012d63', true),
  ('Em negociação', 'em-negociacao', 1, '#eb5b29', true),
  ('Ganho',         'ganho',         2, '#10b981', true),
  ('Perdido',       'perdido',       3, '#ef4444', true)
ON CONFLICT (slug) DO NOTHING;

-- 2. Tags iniciais
INSERT INTO crm.tags (name, color) VALUES
  ('enem', '#012d63'),
  ('ssa',  '#eb5b29'),
  ('sp',   '#6366f1'),
  ('F2',   '#0ea5e9')
ON CONFLICT (name) DO NOTHING;

-- 3. Motivos de perda padrão
INSERT INTO crm.loss_reasons (label, position) VALUES
  ('Valor / Condição financeira', 0),
  ('Horário incompatível',        1),
  ('Optou por concorrente',       2),
  ('Sem resposta após tentativas',3),
  ('Apenas pesquisando',          4),
  ('Outro',                       5)
ON CONFLICT (label) DO NOTHING;
