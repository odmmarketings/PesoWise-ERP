-- INVENTORY RESET MARKER (hiling ng may-ari, Ago 20 2026: "reset tayo, PPW 0").
--
-- Ang PPW ay HINDI nakaimbak na bilang — hinuhusgahan ito nang buhay mula sa
-- Pancake (may waybill na PERO hindi pa nakukuha ng courier, huling 30 araw).
-- Kaya walang buburahin para maging zero ito; ang tanging tapat na paraan ay
-- isang GUHIT SA PETSA: mula sa reset, ang mga order BAGO ang guhit ay hindi
-- na binibilang. Nagsisimula sa zero ang PPW at lalaki lang sa mga BAGONG
-- waybill.
--
-- JSONB na hiwa sa ecommerce_settings, gaya ng ibang setting:
--   inventory_reset = { "ppw_from": "YYYY-MM-DD", "reset_at": ISO, "by": "..." }
alter table public.ecommerce_settings
  add column if not exists inventory_reset jsonb;
