const r=$input.first().json;
if(r.statusCode!==200||!r.body?.id||r.body.app_metadata?.firma!=="gazi"||r.body.app_metadata?.role==="seller")throw new Error("Gazi yönetici oturumu gerekli.");
const p=$('Şubeler · İstek').first().json;
return [{json:{city_code:p.city_code,district_name:p.district_name}}];
