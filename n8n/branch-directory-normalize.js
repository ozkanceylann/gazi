const r=$input.first().json,p=$('Şubeler · İlçeyi Eşleştir').first().json;
if(r.statusCode!==200||!Array.isArray(r.body))throw new Error("DHL şube listesi alınamadı. Yeniden deneyin.");
const norm=s=>String(s||"").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i").replace(/[^a-z0-9]+/g," ").trim();
const district=" "+norm(p.district_name)+" ",prefix="0"+String(p.city_code).padStart(2,"0");
const seen=new Set(),branches=r.body.filter(b=>String(b.BranchCode||"").startsWith(prefix)&&(" "+norm(b.Address)+" ").includes(district)&&b.BranchName&&b.Address).filter(b=>{if(seen.has(b.BranchCode))return false;seen.add(b.BranchCode);return true;}).map(b=>({code:String(b.BranchCode),name:String(b.BranchName),address:String(b.Address),phone:String(b.Phone||"")}));
return [{json:{success:true,environment:"production",branches}}];
