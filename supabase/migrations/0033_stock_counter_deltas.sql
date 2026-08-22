-- ATOMIC COUNTER DELTAS (Ago 22 2026) — ang `released` ng product_items at ang
-- `consumed` ng product_batches ay dating isinusulat ng bawat browser bilang
-- BUONG ROW na may absolute na halaga, galing sa sariling lokal na kopya. Dalawang
-- device na sabay na nagbabawas ay nagpapatungan: parehong nagsimula sa 100, ang
-- isa nagsulat ng 101 at ang isa ng 102 — nawala ang isang bawas nang walang
-- error. Ang lumang cache naman ay kayang mag-urong ng server pabalik sa ilang
-- araw na luma. Ang tanging tapat na ayos: ang DATABASE ang magdagdag, hindi ang
-- kliyente — kapareho ng ".eq(deducted,false)" na tarangkahan ng shipped_out_scans.
--
-- SECURITY INVOKER — sinasadya: ang UPDATE sa loob ay dumadaan pa rin sa RLS ng
-- mismong table, kaya ang hindi miyembro ay walang magagalaw dito.
--
-- Ang kliyente ay RPC muna; kapag wala pa ang mga function na ito (hindi pa
-- tumatakbo ang migration), bumabagsak ito sa basa-muna-bago-sulat na fallback —
-- makitid ang bintana pero hindi zero. PATAKBUHIN ITO para tuluyang masara.

create or replace function public.apply_item_releases(deltas jsonb)
returns void
language sql
security invoker
as $$
  update public.product_items i
     set released = greatest(0, coalesce(i.released, 0) + d.delta)
    from jsonb_to_recordset(deltas) as d(id text, delta int)
   where i.id = d.id;
$$;

create or replace function public.apply_batch_consumed(deltas jsonb)
returns void
language sql
security invoker
as $$
  update public.product_batches b
     set consumed = greatest(0, coalesce(b.consumed, 0) + d.delta)
    from jsonb_to_recordset(deltas) as d(id text, delta int)
   where b.id = d.id;
$$;

grant execute on function public.apply_item_releases(jsonb) to authenticated;
grant execute on function public.apply_batch_consumed(jsonb) to authenticated;
