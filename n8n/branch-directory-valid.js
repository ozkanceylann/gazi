const b=$input.first().json.body||{};
const city=Number(b.city_code), district=String(b.district_name||"").trim();
if(!b.accessToken||!b.publicKey)throw new Error("Oturum gerekli.");
if(!Number.isInteger(city)||city<1||city>81||!district||district.length>100)throw new Error("İl ve ilçe seçin.");
return [{json:{accessToken:b.accessToken,publicKey:b.publicKey,city_code:city,district_name:district}}];
