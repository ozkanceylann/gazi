const r=$input.first().json,p=$('Şubeler · Yetki').first().json;
const norm=s=>String(s||"").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i").replace(/[^a-z0-9]+/g," ").trim();
if(r.statusCode!==200||!Array.isArray(r.body))throw new Error("DHL ilçe listesi alınamadı. Yeniden deneyin.");
const matches=r.body.filter(x=>Number(x.cityId)===p.city_code&&norm(x.districtName)===norm(p.district_name));
if(matches.length!==1)throw new Error("Seçilen ilçe DHL şube listesinde eşleşmedi.");
return [{json:{...p,website_district_id:String(matches[0].districtId)}}];
