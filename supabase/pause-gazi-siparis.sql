-- Beklemedeki gazi-siparis projesinin cron ve çift yönlü senkronizasyonunu kapatır.
-- Ana Gazi n8n kargo süreçleri ve iade etiketini etkilemez.
alter table public.gazi_siparisler disable trigger gazi_plpgsql_source_sync;
alter table gazi_live.orders disable trigger live_source_writeback;
select cron.alter_job(1, active := false);
select cron.alter_job(2, active := false);
