const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{
const db=new PGlite();
try{
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function public.seller_is_gazi_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='true'$$;
grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
create table public.gazi_siparisler(siparis_no integer generated always as identity primary key,
siparis_tel text,ad_soyad text,musteri_tel text,adres text,urun_bilgisi text,sehir text,toplam_tutar text,odeme_sekli text,notlar text,tarih timestamp,musteri_no smallint not null,firma text,siparis_alan text,ilce text,kargo_durumu text,
orderinvoiceid text,orderinvoicedetailid text,shipperbranchcode text,kargo_adet text,sehir_kodu text,ilce_kodu text,kargo_siparis_no text,kargo_takip_kodu text,kargo_qr_kod text,invoiceid text,kargo_kg text,zpl_base64 text,print boolean default false,iptal_nedeni text,iptal_tarihi timestamp,"shipmentStatus" text,kargo_takip_url text,kargo_gunc_saat text,teslimat_aciklama text,gonder_hata_bilgisi text,"shipmentStatusCode" smallint,secilen_urunler text,"isDelivered" boolean default false,kargo_api_yanit text,kargo_zpl text,iade_kodu text,iade_etiket_url text,iade_durumu text,iade_tarihi timestamptz,subeden_teslim boolean not null default false,teslim_subesi text,teslim_sekli_kontrol boolean not null default false,etiket_yazdirma_sayisi integer not null default 0,etiket_son_yazdirma timestamptz,etiket_olusturma_tarihi timestamptz,sube_etiket_durumu text,sube_etiket_tarihi timestamptz);
create table public.tum_siparisler(like public.gazi_siparisler including defaults);
alter table public.tum_siparisler alter column siparis_no add generated always as identity(start with 1000);
create function public.test_master_reference() returns trigger language plpgsql as $$begin perform 1 from tum_siparisler limit 1;new.kargo_siparis_no:='AKH45200'||new.siparis_no;return new;end$$;
create trigger master_reference before insert on public.tum_siparisler for each row execute function public.test_master_reference();
create function public.test_sync_master() returns trigger language plpgsql as $$begin update public.tum_siparisler set toplam_tutar=new.toplam_tutar,urun_bilgisi=new.urun_bilgisi,kargo_adet=new.kargo_adet,kargo_kg=new.kargo_kg where siparis_no=new.siparis_no;return new;end$$;
create trigger sync_master after update on public.gazi_siparisler for each row execute function public.test_sync_master();
alter table public.gazi_siparisler enable row level security;
create policy orders_admin on public.gazi_siparisler for all to authenticated using(public.seller_is_gazi_admin()) with check(public.seller_is_gazi_admin());
grant select,insert,update on public.gazi_siparisler,public.tum_siparisler to authenticated;
`);
const kg=fs.readFileSync('supabase/cargo-kg-plus.sql','utf8').split('create or replace function public.normalize_cargo_kg_plus')[0];await db.exec(kg);
await db.exec(fs.readFileSync('supabase/gazi-order-split.sql','utf8'));
const seed=async(id,changes={})=>{
 const row={siparis_no:id,ad_soyad:'Test Müşteri',urun_bilgisi:'10 kg zeytin\n10 kg yağ',toplam_tutar:'16.500,00',kargo_adet:'2',kargo_kg:'10+10',kargo_durumu:'Bekliyor',musteri_no:1,firma:'Gazi',notlar:'Mevcut not',...changes};
 const cols=Object.keys(row),vals=Object.values(row),sql=cols.map((_,i)=>'$'+(i+1)).join(',');
 await db.query(`insert into public.gazi_siparisler(${cols.map(x=>'"'+x+'"').join(',')}) overriding system value values(${sql})`,vals);
 await db.query(`insert into public.tum_siparisler(${cols.map(x=>'"'+x+'"').join(',')}) overriding system value values(${sql})`,vals);
 return Object.fromEntries(['urun_bilgisi','toplam_tutar','kargo_adet','kargo_kg','kargo_durumu'].map(k=>[k,row[k]]));
};
const expected=await seed(1);
for(let i=2;i<=12;i++)await seed(i,i===4?{orderinvoiceid:'active'}:i===5?{kargo_zpl:'labels'}:i===6?{sube_etiket_durumu:'sent'}:i===7?{toplam_tutar:'30.000,01'}:i===8?{toplam_tutar:'15.000'}:i===12?{urun_bilgisi:'["10 kg zeytin","10 kg yağ"]'}:{});
const parts=[{products:[0],amount:'8.250',count:1,kg:'10'},{products:[1],amount:'8.250',count:1,kg:'10'}];
await db.exec(`set role authenticated;set test.uid='11111111-1111-4111-8111-111111111111';set test.admin='true';`);
let n=0;const call=(id,p=parts,e=expected,request)=>db.query('select public.gazi_split_order($1,$2,$3,$4) as result',[id,request||`22222222-2222-4222-8222-${String(++n).padStart(12,'0')}`,e,p]);
const request='33333333-3333-4333-8333-333333333333';const result=(await call(1,parts,expected,request)).rows[0].result;
assert.equal(result.first_order_id,1);assert.equal(result.second_order_id,1000);
const rows=(await db.query('select siparis_no,toplam_tutar,urun_bilgisi,kargo_durumu,bolunme_sira,kargo_takip_kodu,notlar from public.gazi_siparisler where bolunme_ana_siparis_no=1 order by bolunme_sira')).rows;
assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.toplam_tutar),['8250','8250']);assert.deepEqual(rows.map(x=>x.urun_bilgisi),['10 kg zeytin','10 kg yağ']);assert(rows.every(x=>x.kargo_durumu==='Bekliyor'&&x.kargo_takip_kodu===null&&x.notlar==='Mevcut not'));
assert.equal((await db.query('select sum(toplam_tutar::numeric) n from public.tum_siparisler where siparis_no in (1,1000)')).rows[0].n,'16500');
assert.equal((await call(1,parts,expected,request)).rows[0].result.already_split,true);
await assert.rejects(call(1),/zaten bölünmüş/);
await assert.rejects(call(2,[parts[0],{...parts[1],products:[0]}]),/tekrar/);
await assert.rejects(call(2,[parts[0],{...parts[1],amount:'8000'}]),/toplamı/);
await assert.rejects(call(2,[parts[0],{...parts[1],kg:'9'}]),/kilogram/);
await assert.rejects(call(2,[{...parts[0],amount:'15000.01'},parts[1]]),/15.000/);
await assert.rejects(call(2,[{...parts[0],products:[null]},parts[1]]),/tekrar/);
await assert.rejects(call(2,parts,{...expected,kargo_kg:'5+5'}),/değişmiş/);
for(const id of [4,5,6])await assert.rejects(call(id),/Aktif kargo/);
for(const id of [7,8])await assert.rejects(call(id,parts,{...expected,toplam_tutar:id===7?'30.000,01':'15.000'}),/İki kayda/);
await db.exec("set test.admin='false'");await assert.rejects(call(2),/yönetici/);await db.exec("set test.admin='true'");
await assert.rejects(call(2,parts,expected,request),/başka siparişe/);
// An error after inserts/updates must roll back both orders and the audit.
await db.exec('reset role;create function public.test_reject_audit() returns trigger language plpgsql as $$begin if new.order_id=3 then raise exception \'audit failure\';end if;return new;end$$;create trigger reject_audit before insert on public.gazi_order_splits for each row execute function public.test_reject_audit();set role authenticated;');
await assert.rejects(call(3),/audit failure/);
assert.equal((await db.query('select toplam_tutar from public.gazi_siparisler where siparis_no=3')).rows[0].toplam_tutar,'16.500,00');
assert.equal((await db.query('select count(*) n from public.gazi_siparisler where bolunme_ana_siparis_no=3')).rows[0].n,0);
const e12={...expected,urun_bilgisi:'["10 kg zeytin","10 kg yağ"]'};assert.equal((await call(12,parts,e12)).rows[0].result.first_order_id,12);
await db.exec('reset role;set role anon;');await assert.rejects(call(2),/permission denied/);
console.log('PASS: real Postgres split transaction, shared identity, master totals, products/weights/amount validation, JSON products, stale data, shipment guards, admin/anon permissions, idempotency, duplicate split and rollback after failure');
}finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
