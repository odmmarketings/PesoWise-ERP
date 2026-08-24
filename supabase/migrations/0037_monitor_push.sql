-- PUSH IDS NG MONITORING ROUNDS (Ago 24 2026) — sa pag-freeze ng slot,
-- naka-iskedyul kay OneSignal ang serye ng paalala sa phone ng partner (kada 5
-- minuto habang bukas ang round). Ang mga id ng naka-iskedyul na padala ay
-- nakatali sa slot para MABURA ang mga natitira sa sandaling matapos ang round
-- — walang paalala para sa gawang tapos na.
alter table public.monitor_slots
  add column if not exists push_ids jsonb not null default '[]';
