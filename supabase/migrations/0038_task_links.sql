-- 0038: TASK MULA SA KOMENTO SA AD (hatol ng may-ari, Ago 25 2026: "bukod sa
-- comment, add task sa kanila, tapos pag pinindot nila sa task nila ma
-- reredirect sila sa ads na aayusin nila instead of comment").
--
-- Ang task ay maaaring may dalang deep link papunta sa mismong ad sa Ads
-- Manager (link_href) at ang mababasang pangalan nito (link_label) — blangko
-- ang dalawa para sa ordinaryong task. Walang bagong RLS: mga kolum lang ito
-- sa partner_tasks, saklaw na ng member-wide na patakaran ng 0029.
alter table public.partner_tasks
  add column if not exists link_href  text not null default '',
  add column if not exists link_label text not null default '';
